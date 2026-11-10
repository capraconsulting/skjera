# Automatic preview demo

This draft PR demonstrates the automatic preview pipeline without changing the app.

After CI passes, the preview workflow publishes the app through Argo CD with its own
PostgreSQL database and S3 bucket. The workflow reports the preview URL when ready.

Close this PR when finished to remove the preview and its resources automatically.

A healthy preview now adds a **View deployment** link directly to this PR.
