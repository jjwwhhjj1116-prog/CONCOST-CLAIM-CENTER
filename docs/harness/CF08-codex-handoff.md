# CF08 Codex Handoff — D1 Report Review & Independent Approval

## Objective

Move a saved D1 report revision through an auditable request, review, approval, or changes-requested workflow without allowing self-approval or stale-version approval.

## Scope

1. Immutable review request bound to one exact report revision and version.
2. One pending review per case, request idempotency, and append-only review events.
3. Independent decision enforcement: requester cannot approve or request changes on their own submission.
4. Assigned-case and role-scoped APIs for queue, submission, approval, and changes requested.
5. Report Studio submission/status controls and a real D1 APPR-01 queue.
6. Optimistic stale-version rejection, restart persistence, additive migration, automated regressions, GitHub push, remote D1 migration, and live deployment verification.

## Deferred

- DOCX/PDF final output remains CF09.
- Google Drive OAuth/file storage remains `DEFERRED_BY_USER`.
- R2 remains `SKIPPED_BY_USER`.
