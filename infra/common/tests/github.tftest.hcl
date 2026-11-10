# Publishing credentials must remain separate from the infrastructure operator.
mock_provider "aws" {
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  override_resource {
    target = aws_ecr_repository.app
    values = { arn = "arn:aws:ecr:eu-north-1:123456789012:repository/skjera-dev" }
  }
}

variables {
  aws_account_id      = "123456789012"
  aws_region          = "eu-north-1"
  environment         = "dev"
  deployment_role_arn = "arn:aws:iam::123456789012:role/skjera-dev-opentofu"
  kubernetes_version  = "1.35"
  availability_zones  = ["eu-north-1a", "eu-north-1b"]
  admin_principal_arn = "arn:aws:iam::123456789012:role/Admin"
  api_access_cidrs    = ["192.0.2.1/32"]
}

run "github_repository_trust" {
  command = plan
  plan_options {
    target = [aws_iam_role.github_ecr, aws_iam_role_policy.github_ecr]
  }

  assert {
    condition = (
      jsondecode(aws_iam_role.github_ecr.assume_role_policy).Statement[0].Action == "sts:AssumeRoleWithWebIdentity" &&
      jsondecode(aws_iam_role.github_ecr.assume_role_policy).Statement[0].Principal.Federated == "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" &&
      jsondecode(aws_iam_role.github_ecr.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com" &&
      jsondecode(aws_iam_role.github_ecr.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == [
        "repo:capraconsulting@1316242/skjera@1408710589:ref:refs/heads/main",
        "repo:capraconsulting@1316242/skjera@1408710589:pull_request",
      ]
    )
    error_message = "Only this repository's immutable identity on main and PRs may obtain publishing credentials with the STS audience."
  }
}

run "publishing_scope" {
  command = plan
  plan_options {
    target = [aws_iam_role.github_ecr, aws_iam_role_policy.github_ecr]
  }

  assert {
    condition = (
      length(jsondecode(aws_iam_role_policy.github_ecr.policy).Statement) == 2 &&
      jsondecode(aws_iam_role_policy.github_ecr.policy).Statement[0].Action == "ecr:GetAuthorizationToken" &&
      jsondecode(aws_iam_role_policy.github_ecr.policy).Statement[0].Resource == "*" &&
      jsondecode(aws_iam_role_policy.github_ecr.policy).Statement[0].Condition.StringEquals["aws:RequestedRegion"] == "eu-north-1" &&
      jsondecode(aws_iam_role_policy.github_ecr.policy).Statement[1].Resource == aws_ecr_repository.app.arn &&
      toset(jsondecode(aws_iam_role_policy.github_ecr.policy).Statement[1].Action) == toset([
        "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer",
        "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage",
      ])
    )
    error_message = "The CI role must only authenticate to ECR and publish/read images in the app repository, with no deletion or provisioning permissions."
  }
}

run "reject_wildcard_repository" {
  command = plan
  plan_options {
    target = [aws_iam_role.github_ecr]
  }
  variables {
    github_oidc_subject_prefix = "repo:capraconsulting/*"
  }
  expect_failures = [var.github_oidc_subject_prefix]
}
