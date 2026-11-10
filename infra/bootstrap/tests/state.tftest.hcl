# Exercise the bootstrap handoff without credentials or real AWS resources.
mock_provider "aws" {
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  override_resource {
    target = aws_s3_bucket.state
    values = {
      id  = "skjera-dev-tofu-123456789012-eu-north-1"
      arn = "arn:aws:s3:::skjera-dev-tofu-123456789012-eu-north-1"
    }
  }
  override_resource {
    target = aws_iam_role.opentofu
    values = {
      id  = "skjera-dev-opentofu"
      arn = "arn:aws:iam::123456789012:role/skjera-dev-opentofu"
    }
  }
}

variables {
  aws_account_id         = "123456789012"
  environment            = "dev"
  trusted_principal_arns = ["arn:aws:iam::123456789012:role/Admin"]
}

run "state_and_identity_handoff" {
  command = plan

  assert {
    condition = (
      jsondecode(output.common_bootstrap_vars).deployment_role_arn == aws_iam_role.opentofu.arn &&
      strcontains(output.common_backend_config, aws_iam_role.opentofu.arn) &&
      strcontains(output.common_backend_config, aws_s3_bucket.state.id) &&
      strcontains(output.common_backend_config, "use_lockfile        = true")
    )
    error_message = "Backend and provider must use the same bootstrap identity and native locking."
  }

  assert {
    condition = (
      alltrue([for key in local.state_keys : contains(jsondecode(aws_iam_role_policy.state.policy).Statement[1].Resource, "${aws_s3_bucket.state.arn}/${key}")]) &&
      !contains(jsondecode(aws_iam_role_policy.state.policy).Statement[1].Action, "s3:DeleteObject") &&
      alltrue([for key in local.state_keys : contains(jsondecode(aws_iam_role_policy.state.policy).Statement[2].Resource, "${aws_s3_bucket.state.arn}/${key}.tflock")]) &&
      contains(jsondecode(aws_iam_role_policy.state.policy).Statement[2].Action, "s3:DeleteObject")
    )
    error_message = "The common role must manage the matching lock without permission to delete state."
  }

  assert {
    condition = (
      aws_s3_bucket_versioning.state.versioning_configuration[0].status == "Enabled" &&
      aws_s3_bucket_public_access_block.state.block_public_acls &&
      aws_s3_bucket_public_access_block.state.block_public_policy &&
      aws_s3_bucket_public_access_block.state.ignore_public_acls &&
      aws_s3_bucket_public_access_block.state.restrict_public_buckets &&
      jsondecode(aws_s3_bucket_policy.state.policy).Statement[0].Effect == "Deny" &&
      jsondecode(aws_s3_bucket_policy.state.policy).Statement[0].Condition.Bool["aws:SecureTransport"] == "false"
    )
    error_message = "State recovery and private HTTPS-only access must be enabled."
  }

  assert {
    condition = (
      jsondecode(aws_iam_role.opentofu.assume_role_policy).Statement[0].Principal.AWS == ["arn:aws:iam::123456789012:role/Admin"] &&
      alltrue([
        for statement in jsondecode(aws_iam_role_policy.provision.policy).Statement :
        !strcontains(jsonencode(statement.Resource), ":role/skjera-dev-opentofu")
      ])
    )
    error_message = "Only configured principals may assume the role, which must not manage its own IAM definition."
  }
}

run "preview_bucket_permissions" {
  command = plan

  assert {
    condition = (
      jsondecode(aws_iam_role_policy.crossplane_s3.policy).Statement[0].Resource == "arn:aws:s3:::skjera-dev-app-123456789012-*" &&
      !contains(jsondecode(aws_iam_role_policy.crossplane_s3.policy).Statement[0].Action, "s3:*") &&
      jsondecode(aws_iam_role_policy.crossplane_s3.policy).Statement[1].Resource == "arn:aws:s3:::skjera-dev-app-123456789012-*/*" &&
      jsondecode(aws_iam_role_policy.crossplane_s3.policy).Statement[1].Action == ["s3:DeleteObject", "s3:DeleteObjectVersion"]
    )
    error_message = "Crossplane must be limited to the app bucket prefix, with object deletion only for cleanup."
  }

  assert {
    condition = (
      jsondecode(aws_iam_role.crossplane_s3.assume_role_policy).Statement[0].Condition.StringEquals["aws:RequestTag/kubernetes-service-account"] == "provider-aws-s3" &&
      jsondecode(aws_iam_role.crossplane_s3.assume_role_policy).Statement[0].Condition.StringEquals["aws:RequestTag/kubernetes-namespace"] == "crossplane-system" &&
      jsondecode(aws_iam_role.crossplane_s3.assume_role_policy).Statement[0].Condition.StringEquals["aws:RequestTag/eks-cluster-name"] == "skjera-dev"
    )
    error_message = "Only the S3 provider service account in the configured cluster may use this identity."
  }
}

run "reject_session_arn" {
  command = plan
  variables {
    trusted_principal_arns = ["arn:aws:sts::123456789012:assumed-role/Admin/session"]
  }
  expect_failures = [var.trusted_principal_arns]
}

run "gateway_tls_permissions" {
  command = plan

  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role_policy.dns.policy).Statement : (
        statement.Condition["ForAllValues:StringEquals"]["route53:ChangeResourceRecordSetsRecordTypes"] == ["A", "CNAME"] &&
        contains(statement.Condition["ForAllValues:StringLike"]["route53:ChangeResourceRecordSetsNormalizedRecordNames"], "skjera.capraconsulting.no") &&
        !contains(statement.Condition["ForAllValues:StringLike"]["route53:ChangeResourceRecordSetsNormalizedRecordNames"], "capraconsulting.no")
      ) if statement.Sid == "ManageSkjeraRecords"
    ])
    error_message = "DNS writes must cover only app aliases and validation CNAMEs under Skjera, never parent records or NS delegation."
  }

  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role_policy.certificates.policy).Statement :
      !contains(statement.Action, "acm:ExportCertificate") && !contains(statement.Action, "acm:*")
    ])
    error_message = "The gateway certificate role must not export private keys or have unrestricted ACM permissions."
  }
}

run "preview_workload_isolation" {
  command = plan
  assert {
    condition = (
      jsondecode(aws_iam_role.preview_app.assume_role_policy).Statement[0].Principal.Service == "pods.eks.amazonaws.com" &&
      jsondecode(aws_iam_role.preview_app.assume_role_policy).Statement[0].Condition.StringEquals["aws:RequestTag/kubernetes-namespace"] == "skjera-$${aws:RequestTag/kubernetes-service-account}" &&
      jsondecode(aws_iam_role.preview_app.assume_role_policy).Statement[0].Condition.StringLike["aws:RequestTag/kubernetes-service-account"] == "pr-*" &&
      jsondecode(aws_iam_role.preview_app.assume_role_policy).Statement[0].Condition.StringEquals["aws:RequestTag/eks-cluster-name"] == "skjera-dev"
    )
    error_message = "The app identity must bind service account pr-N to namespace skjera-pr-N in this cluster."
  }
  assert {
    condition = (
      jsondecode(aws_iam_role_policy.preview_app.policy).Statement[0].Resource == "arn:aws:s3:::skjera-dev-app-123456789012-$${aws:PrincipalTag/kubernetes-service-account}-images" &&
      jsondecode(aws_iam_role_policy.preview_app.policy).Statement[1].Resource == "arn:aws:s3:::skjera-dev-app-123456789012-$${aws:PrincipalTag/kubernetes-service-account}-images/*" &&
      jsondecode(aws_iam_role_policy.preview_app.policy).Statement[1].Action == ["s3:GetObject", "s3:PutObject"]
    )
    error_message = "App access must be scoped by session tag to its own bucket and must not manage bucket/object deletion."
  }
}
