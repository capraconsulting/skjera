function(config)
  [
    {
      apiVersion: 'postgresql.cnpg.io/v1',
      kind: 'Cluster',
      metadata: {
        name: 'postgres',
        namespace: config.namespace,
        annotations: { 'argocd.argoproj.io/sync-wave': '-20' },
      },
      spec: {
        // Single-instance previews; production needs a separate policy.
        instances: 1,
        imageName: 'ghcr.io/cloudnative-pg/postgresql:18-minimal-trixie@sha256:c9be7f221a05b18fe65259d9136affbabe3b39ad91c3b68f8f2f990a45f35f38',
        enableSuperuserAccess: false,
        bootstrap: { initdb: { database: 'skjera', owner: 'skjera' } },
        storage: {
          size: config.postgresStorageSize,
          storageClass: 'cnpg-preview-gp3',
        },
        resources: {
          requests: { cpu: '500m', memory: '2Gi' },
          limits: { cpu: '500m', memory: '2Gi' },
        },
        postgresql: {
          parameters: {
            default_toast_compression: 'lz4',
            shared_buffers: '256MB',
            max_connections: '20',
            'pg_automerge.max_load_memory': '256MB',
            'pg_automerge.trim_threshold': '16MB',
          },
          extensions: [{
            name: 'pg-automerge',
            image: {
              reference: 'ghcr.io/theknarf/pg-automerge-cnpg:0.1.0-18-trixie@sha256:2779594693139be7a3053e9358c5b458891532cd67d64672214fcfc5b5a57735',
            },
          }],
        },
      },
    },
    {
      apiVersion: 'postgresql.cnpg.io/v1',
      kind: 'Database',
      metadata: {
        name: 'postgres-app',
        namespace: config.namespace,
        annotations: { 'argocd.argoproj.io/sync-wave': '-10' },
      },
      spec: {
        name: 'skjera',
        owner: 'skjera',
        cluster: { name: 'postgres' },
        databaseReclaimPolicy: 'delete',
        extensions: [{ name: 'pg_automerge', version: '0.1.0' }],
      },
    },
  ]
