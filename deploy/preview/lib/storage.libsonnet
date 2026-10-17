function(config)
  local metadata(wave) = {
    name: 'images',
    namespace: config.namespace,
    annotations: { 'argocd.argoproj.io/sync-wave': wave },
  };
  local provider = { kind: 'ClusterProviderConfig', name: 'aws-s3' };
  local bucketName = 'skjera-%s-app-%s-%s-images' % [config.environment, config.awsAccountId, config.previewId];
  assert std.length(bucketName) <= 63 : 'Generated bucket name exceeds the S3 limit';
  [
    {
      apiVersion: 's3.aws.m.upbound.io/v1beta1',
      kind: 'Bucket',
      metadata: metadata('-20') + {
        annotations+: { 'crossplane.io/external-name': bucketName },
      },
      spec: {
        managementPolicies: ['*'],
        forProvider: {
          region: config.awsRegion,
          // Disposable previews: Crossplane empties the bucket on deletion.
          forceDestroy: true,
          tags: {
            Project: 'skjera',
            Environment: config.environment,
            Preview: config.previewId,
            ManagedBy: 'Crossplane',
          },
        },
        providerConfigRef: provider,
      },
    },
    {
      apiVersion: 's3.aws.m.upbound.io/v1beta1',
      kind: 'BucketPublicAccessBlock',
      metadata: metadata('-10'),
      spec: {
        managementPolicies: ['*'],
        forProvider: {
          region: config.awsRegion,
          bucketRef: { name: 'images' },
          blockPublicAcls: true,
          blockPublicPolicy: true,
          ignorePublicAcls: true,
          restrictPublicBuckets: true,
        },
        providerConfigRef: provider,
      },
    },
    {
      apiVersion: 's3.aws.m.upbound.io/v1beta1',
      kind: 'BucketServerSideEncryptionConfiguration',
      metadata: metadata('-10'),
      spec: {
        managementPolicies: ['*'],
        forProvider: {
          region: config.awsRegion,
          bucketRef: { name: 'images' },
          rule: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: 'AES256' } }],
        },
        providerConfigRef: provider,
      },
    },
  ]
