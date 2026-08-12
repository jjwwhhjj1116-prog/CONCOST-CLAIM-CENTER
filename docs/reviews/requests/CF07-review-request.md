# CF07 Review Request — D1 Report Studio Autosave & Revision History

## Scope

Review implementation commit `547e782eda0d21f2e174a1e96df9de26df72c3d9` against `docs/harness/CF07-codex-handoff.md`.

## Required checks

1. `manifest.json.changedFiles` exactly matches the implementation commit diff-tree.
2. Each accessible case has at most one active draft and every accepted save appends an immutable revision.
3. Autosave uses optimistic versions and stale writes receive HTTP 409 without overwriting newer content.
4. Reviewer is read-only and unassigned or cross-organization access is rejected.
5. Browser/Worker restart preserves saved report title, body, current version, and revision history in D1.
6. The production route displays the honest no-case state until the first real case is registered.
7. Google Drive remains disconnected/deferred and R2 remains skipped.

## Evidence

- `artifacts/harness/CF07/manifest.json`
- `artifacts/harness/CF07/notes.md`
- `artifacts/harness/CF07/commands.log`
- Live: `https://concost-claim-center-preview.jjwwhhjj1116.workers.dev/reports/studio`
