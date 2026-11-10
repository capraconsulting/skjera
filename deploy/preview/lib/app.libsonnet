function(config)
  local metadata(name, wave='0') = {
    name: name,
    namespace: config.namespace,
    annotations: { 'argocd.argoproj.io/sync-wave': wave },
  };
  local secret(key) = { valueFrom: { secretKeyRef: { name: config.appSecretName, key: key } } };
  local deployment(name, container, wave, account=null) = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: metadata(name, wave),
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: name } },
      template: {
        metadata: { labels: { app: name } },
        spec: {
          automountServiceAccountToken: false,
          securityContext: { runAsNonRoot: true, seccompProfile: { type: 'RuntimeDefault' } },
          containers: [container {
            securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
          }],
        } + (if account == null then {} else { serviceAccountName: account }),
      },
    },
  };
  local service(name, port, wave='0') = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: metadata(name, wave),
    spec: { selector: { app: name }, ports: [{ name: 'http', port: port, targetPort: port }] },
  };
  local route(name, path, backend, port, wave='0') = {
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'HTTPRoute',
    metadata: metadata(name, wave),
    spec: {
      parentRefs: [{ name: 'previews', namespace: 'envoy-gateway-system', sectionName: 'https' }],
      hostnames: [config.hostname],
      rules: [{ matches: [{ path: { type: 'PathPrefix', value: path } }], backendRefs: [{ name: backend, port: port }] }],
    },
  };
  [
    {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        name: config.namespace,
        labels: { 'skjera.capraconsulting.no/preview': 'true' },
        annotations: { 'argocd.argoproj.io/sync-wave': '-30' },
      },
    },
    {
      apiVersion: 'v1',
      kind: 'ServiceAccount',
      metadata: metadata(config.previewId, '-15'),
      automountServiceAccountToken: false,
    },
    {
      apiVersion: 'eks.aws.m.upbound.io/v1beta1',
      kind: 'PodIdentityAssociation',
      metadata: metadata('app', '-10'),
      spec: {
        managementPolicies: ['*'],
        providerConfigRef: { kind: 'ClusterProviderConfig', name: 'aws-s3' },
        forProvider: {
          region: config.awsRegion,
          clusterName: 'skjera-' + config.environment,
          namespace: config.namespace,
          serviceAccount: config.previewId,
          roleArn: 'arn:aws:iam::%s:role/skjera-%s-preview-app' % [config.awsAccountId, config.environment],
          disableSessionTags: false,
          tags: { Project: 'skjera', Preview: config.previewId, ManagedBy: 'Crossplane' },
        },
      },
    },
    deployment('app', {
      name: 'app',
      image: config.image,
      ports: [{ name: 'http', containerPort: 3000 }],
      resources: { requests: { cpu: '250m', memory: '512Mi' }, limits: { memory: '1Gi' } },
      startupProbe: { httpGet: { path: '/health/ready', port: 3000 }, periodSeconds: 5, failureThreshold: 60 },
      readinessProbe: { httpGet: { path: '/health/ready', port: 3000 } },
      livenessProbe: { httpGet: { path: '/health', port: 3000 } },
      env: [
        { name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: 'postgres-app', key: 'uri' } } },
        { name: 'SIGNING_SECRET' } + secret('signing-secret'),
        { name: 'OAUTH_CLIENT_SECRET' } + secret('oidc-client-secret'),
      ] + [
        { name: name, value: settings[name] }
        for settings in [{
          NODE_ENV: 'production',
          PORT: '3000',
          HOST: '0.0.0.0',
          SITE_URL: config.siteUrl,
          SITE_NAME: 'Skjera PR ' + config.prNumber,
          SITE_LOCALE: 'en',
          SITE_OPERATOR: 'Capra preview (test)',
          SITE_CONTACT_EMAIL: 'preview@example.invalid',
          S3_BUCKET: 'skjera-%s-app-%s-%s-images' % [config.environment, config.awsAccountId, config.previewId],
          S3_REGION: config.awsRegion,
          AWS_REGION: config.awsRegion,
          S3_CREATE_BUCKET: 'false',
          AWS_EC2_METADATA_DISABLED: 'true',
          OAUTH_ISSUER: config.oidcIssuer,
          OAUTH_CLIENT_ID: config.oidcClientId,
          OAUTH_REDIRECT_URI: config.siteUrl + '/auth/callback',
          OAUTH_ALLOWED_DOMAINS: config.oidcAllowedDomains,
          EMAIL_FROM: 'Skjera preview <preview@example.invalid>',
        }]
        for name in std.objectFields(settings)
      ],
    }, '0', config.previewId),
    service('app', 3000),
    route('app', '/', 'app', 3000),
  ] + if !config.useDex then [] else [
    deployment('dex', {
      name: 'dex',
      image: 'ghcr.io/dexidp/dex:v2.45.1@sha256:8499afd690c437f52301efd2b05b2455da5bd2dfc20332cd697dc9937f808462',
      args: ['dex', 'serve', '/etc/dex/config.yaml'],
      ports: [{ name: 'http', containerPort: 5556 }, { name: 'health', containerPort: 5558 }],
      resources: { requests: { cpu: '100m', memory: '64Mi' }, limits: { memory: '256Mi' } },
      readinessProbe: { httpGet: { path: '/healthz', port: 5558 } },
      livenessProbe: { httpGet: { path: '/healthz', port: 5558 } },
      volumeMounts: [{ name: 'config', mountPath: '/etc/dex', readOnly: true }],
    }, '-5') + {
      spec+: { template+: { spec+: {
        securityContext+: { runAsUser: 1001 },
        volumes: [{ name: 'config', secret: { secretName: config.appSecretName, items: [{ key: 'dex-config', path: 'config.yaml' }] } }],
      } } },
    },
    service('dex', 5556, '-5'),
    route('dex', '/dex', 'dex', 5556, '-5'),
  ]
