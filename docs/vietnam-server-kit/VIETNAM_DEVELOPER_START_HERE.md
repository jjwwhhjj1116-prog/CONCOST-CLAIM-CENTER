# CONCOST Claim Center — Vietnam Server Implementation Start Here

Date: 2026-08-25

This package is an implementation kit, not a finished production server. The browser client bridge for Yjs/Hocuspocus is already included. The Vietnam team must connect the private server, PostgreSQL, application authentication and reverse proxy without replacing the existing business workflow.

## 1. Required order

1. Read `handoff/vietnam-primary-server-migration-handoff.md`.
2. Read `handoff/vietnam-yjs-hocuspocus-handoff.md`.
3. Apply `server-kit/migrations/001_collaboration_documents.sql` to PostgreSQL.
4. Deploy `server-kit/collaboration-server` on Node.js 22 or newer.
5. Merge `server-kit/api/collaboration-token-service.example.ts` into the authenticated application API. Do not expose a public unsigned token endpoint.
6. Configure the reverse proxy from `server-kit/nginx/claim-center.conf.example`.
7. Publish `server-kit/runtime-config.production.example.js` as `/runtime-config.js`, after replacing only the server URLs.
8. Merge the files under `web-overlay/` by diff. Do not overwrite a newer GitHub file wholesale.
9. Execute the two-account acceptance test in the Yjs/Hocuspocus handoff.
10. Deliver the evidence listed in the primary-server handoff.

## 2. Security rules that must not be changed

- PostgreSQL, Redis, Hocuspocus, Gotenberg and AI memory services stay on a private network.
- The collaboration JWT is issued only after validating the existing HttpOnly login session, organization, project assignment, document permission and final-lock status.
- The browser receives a five-minute document-scoped JWT. It never receives the signing secret, database credentials or OAuth secret.
- Every room name starts with `claim-center:{organizationId}:`; the Hocuspocus server revalidates the organization from the token.
- Yjs binary is the live collaboration state. Approved Tiptap JSON/document versions remain the auditable business record.
- HWP/HWPX files are final import/export artifacts, not the multi-user live state.

## 3. Local verification

```bash
cd server-kit/collaboration-server
corepack pnpm install --ignore-workspace --frozen-lockfile
corepack pnpm typecheck
```

Run the web repository tests after merging the overlay:

```bash
corepack pnpm test:cf58
corepack pnpm test:cf60
corepack pnpm test:cf61
corepack pnpm cf:build
```

## 4. Definition of done

The work is not complete when WebSocket merely connects. It is complete only when all of the following pass:

- Two different approved accounts see each other's edits and carets in the same document.
- Refreshing both browsers restores the same content from PostgreSQL.
- A user from another organization receives 403/authentication failure.
- A user without document permission cannot obtain a token.
- A finalized proposal/report is read-only.
- When Hocuspocus is unavailable, the screen shows offline state and the existing manual/version save path remains usable.
- Imported HWP/HWPX can be edited and exported; export is disabled when no original document has been imported.
- No secret is present in `runtime-config.js`, the browser bundle, Git history or logs.

## 5. Files to return to CONCOST

- Infrastructure and application source commit IDs
- PostgreSQL migration result
- Two-account collaboration recording or screenshots
- Access-denied evidence for another organization and an unassigned user
- Restart/recovery and final-document-lock evidence
- HWP/HWPX import-edit-export evidence
- Updated environment-variable inventory containing names only, never secret values
