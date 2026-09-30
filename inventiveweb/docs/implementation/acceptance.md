# Staging acceptance

Automated local checks are recorded in verification.md. These runtime gates remain unchecked.

- [ ] Build the complete branded image from the pinned source and record its digest.
- [ ] Compose starts with server and worker healthy; migration failures stop startup.
- [ ] Server, worker, PostgreSQL and Redis have no public host ports or direct domains.
- [ ] Login, password reset, invitation and email verification show InventiveWeb branding.
- [ ] Source/licence links work; archive matches the deployed patch and contains no secrets.
- [ ] Browser title/favicon, workspace fallback, onboarding and email assets load correctly.
- [ ] Audit remaining settings, AI, billing/upgrade prompts and localized strings for branding.
- [ ] Do not present an upstream Twenty DPA as an InventiveWeb customer agreement.
- [ ] Official native app sync succeeds without deleting unrelated metadata.
- [ ] Sidebar Form builder and Settings → Apps → InventiveWeb → Forms render in the native host.
- [ ] Save/reload a form draft and verify actual Twenty records; test denied role behavior.
- [ ] Customer preview excludes staff-only fields; dependencies and required rules work.
- [ ] Direct API writes to application-managed financial/appointment/version objects are denied.
- [ ] Publishing denies read-only users and API-key/anonymous callers; test native scoped-token behavior.
- [ ] Both unique indexes exist; concurrent publications from separate processes converge.
- [ ] Stale/unsaved drafts return 409; draft edits preserve earlier published versions.
- [ ] Service selection rejects other forms and non-appointment versions; denied roles cannot select.
- [ ] A concurrent service form change causes selection to return 409.
- [ ] Two workspaces cannot cross-read records, files, form definitions or app routes.
- [ ] Only the platform operator can administer integrations; direct API and OAuth routes tested.
- [ ] Gateway MCP requests return 403 while its implementation remains incomplete.
- [ ] Backups restore successfully into a separate instance, including files and encryption keys.

Feature tests for booking, customer document views, accounting and messaging are added with
those implementations. None is represented by an empty object or a successful SDK build.
