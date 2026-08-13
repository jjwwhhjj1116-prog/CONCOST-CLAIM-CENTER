# CF08 Review Request — D1 Report Review & Independent Approval

## Scope

Review implementation commit `84ffd86cc548724818e70cf75f09ce19ff72ddc9` against `docs/harness/CF08-codex-handoff.md`.

## Required checks

1. `manifest.json.changedFiles` exactly matches the implementation commit diff-tree.
2. Every request points to one exact immutable CF07 revision and version.
3. Request replay is idempotent and a conflicting key is rejected.
4. Requester self-approval, unassigned access, unauthorized decisions, and stale approval are rejected.
5. D1 raw writes cannot create terminal requests, bypass independent roles, mutate identities, delete history, or rewrite events.
6. The Report Studio only submits a saved version and APPR-01 uses the real D1 queue.
7. A browser/Worker restart preserves request, decision, and append-only event history.
8. Google Drive remains deferred, R2 remains skipped, and final DOCX/PDF remains CF09.

## Evidence

- `artifacts/harness/CF08/manifest.json`
- `artifacts/harness/CF08/notes.md`
- `artifacts/harness/CF08/commands.log`
- Live: `https://concost-claim-center-preview.jjwwhhjj1116.workers.dev/approval`
