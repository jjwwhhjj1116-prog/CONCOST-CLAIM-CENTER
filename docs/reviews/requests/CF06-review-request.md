# CF06 Review Request — D1 Case Operations & Live Dashboard

## Scope

Review implementation commit `3aa4396fcc526771209735393f7c021be947ab0d` against `docs/harness/CF06-codex-handoff.md`.

## Required checks

1. `manifest.json.changedFiles` exactly matches the implementation commit diff-tree.
2. The Cloudflare preview uses D1 data for DASH-01 and CASE-01 through CASE-05.
3. Six exact claim types and twelve ordered states remain enforced.
4. Non-admin users cannot read unassigned cases or mutate cases without a permitted role.
5. Status mutation is optimistic and activity history is append-only.
6. A created case survives a database export/restart regression.
7. Google Drive remains disconnected/deferred and R2 remains skipped.

## Evidence

- `artifacts/harness/CF06/manifest.json`
- `artifacts/harness/CF06/notes.md`
- `artifacts/harness/CF06/commands.log`
- Live: `https://concost-claim-center-preview.jjwwhhjj1116.workers.dev/dashboard`
