# CF07 Codex Handoff — D1 Report Studio Autosave & Revision History

## Objective

Prevent report authoring loss when a browser tab, PC, or Worker session closes by persisting the active case report in Cloudflare D1.

## Scope

1. One active D1 report draft per case with title, body, optimistic version, author, and timestamps.
2. Append-only revision snapshots for every successful save.
3. Authenticated, assignment-scoped read and role-scoped write APIs.
4. Cloudflare preview Report Studio UI with case selection, 900ms autosave, explicit save, last-saved state, version, and recent revision history.
5. Stale-response and optimistic-conflict safeguards when switching cases or editing from multiple tabs.
6. Additive migration, deterministic API regression, GitHub push, production D1 migration, and live deployment verification.

## Deferred

- Google Drive OAuth/file storage remains `DEFERRED_BY_USER`.
- R2 remains `SKIPPED_BY_USER`.
- Approval/final output and AI generation remain later Cloudflare stages.
