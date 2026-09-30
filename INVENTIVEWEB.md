# InventiveWeb implementation

The native business app, branding and Coolify configuration live in [inventiveweb/](inventiveweb/).
Start with its [README](inventiveweb/README.md) and [staging runbook](inventiveweb/docs/implementation/coolify.md).

The app requires Twenty **2.43.0**. This fork's current SDK source is **2.15.0**.
The staging Dockerfile pins and builds upstream 2.43.0 separately. Installing the app into the
older checkout or treating this PR as a database upgrade is unsupported.

The initial implementation and form-publishing increment are reviewable in this folder.
No production server, database, OAuth app or customer account has been changed.
