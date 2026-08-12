# CF06 Codex Handoff — D1 Case Operations & Live Dashboard

## Decision

- Google Drive live OAuth and file upload are `DEFERRED_BY_USER` and do not block case work.
- R2 remains `SKIPPED_BY_USER`.
- CF06 converts the Cloudflare preview's core case operations from static cards to authenticated D1-backed workflows.

## Scope

1. D1 tables for cases, assignments, parties, schedules, and append-only activities.
2. Authenticated same-origin APIs for dashboard KPI, case list/search/create/detail, optimistic status transitions, parties, and schedules.
3. Server-side role and assignment enforcement. Admin can read all cases; other members read assigned cases only.
4. Existing CASE-01 through CASE-05 and DASH-01 production UI connected to the Cloudflare APIs.
5. Strict six-type claim contract, 12-state lifecycle, optimistic version conflict, no physical delete, and bounded inputs.
6. Additive migration and regression tests; GitHub push and Cloudflare deployment.

## Explicit exclusions

- No R2 activation or payment setup.
- No fake Google credential, file identifier, or connected state.
- No production Google account until the user resumes that work.
- Reports, approvals, AI generation, and document binary migration remain later Cloudflare workstreams.
