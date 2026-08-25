# CONCOST Claim Center — Tasks After Connecting the Company Server

Version: 2026-08-25
Audience: Vietnam backend, infrastructure, database, and QA engineers

This document starts **after the company server, domain, TLS certificate, and private network are available**. Do not declare completion merely because the web page opens. The existing Cloudflare Preview is the functional reference until every acceptance test below passes.

## 1. Target architecture

Route one HTTPS origin through Nginx or Caddy:

- `/` and `/assets/*` → the built React application
- `/api/*`, `/auth/*`, `/health`, `/readiness` → the Node.js application API
- `/collaboration/*` → Hocuspocus WebSocket

Keep PostgreSQL, Redis, Hocuspocus, Gotenberg, Mem0/LangGraph/Hermes, and backup services on the private network. Do not expose their service ports to the public Internet.

## 2. Port the complete application API

The latest workflow contract is implemented in `apps/cloudflare/src/index.ts` and Cloudflare migrations `0001` through `0043`. `apps/api/src/server.ts` is an older Node/SQLite baseline and is **not** a complete replacement.

Port every current endpoint while preserving request/response JSON, status codes, error codes, session behavior, optimistic version checks, role checks, and audit records. Required modules:

1. Login, session, user approval, password change, roles, and administrator accounts
2. Project intake, intake attachments, Gemini-assisted intake summary, and intake archives
3. Proposal templates, prompt rules, AI draft, human editing, final preview, confirmation, export, database archive, and award decision
4. Project acceptance, ERP bridge, PM assignment, six-stage schedule, bidirectional schedule updates, and change approval
5. Kickoff meeting, site survey, quantity/cost files, evidence categories, Google Drive, uploader, timestamp, and SHA-256 metadata
6. Report template, outline, chapter prompts, AI draft, human editing, autosave, resume, approval, final output, and archive
7. Court records, litigation schedules, post-delivery management, notifications, settings, tutorial, and audit history

All browser-supplied organization, project, case, document, and user IDs must be verified again from the authenticated server session.

## 3. Migrate D1 data and schema to PostgreSQL

Apply a reviewed PostgreSQL migration, not raw SQLite SQL.

- Preserve foreign keys, unique constraints, soft-delete rules, version guards, and audit history.
- Convert JSON string columns to validated `jsonb` where appropriate.
- Convert D1 `batch()` operations into PostgreSQL transactions.
- Preserve Tiptap JSON, Markdown snapshots, proposal chapters, prompt versions, document revisions, Drive metadata, and final locks.
- Compare source and target row counts and document-version counts.
- If production data is migrated, produce a table-by-table migration report and SHA-256 evidence.

Do not delete or shut down the Cloudflare Preview before data verification and business acceptance are complete.

## 4. Configure authentication and secrets

Store actual values only in the server secret manager or protected environment. Never commit them to Git, `/runtime-config.js`, frontend assets, logs, screenshots, or support tickets.

Required secret categories include:

- database and Redis connection strings
- session cookie secret
- Google OAuth Client ID and Client Secret
- encryption keys for Google refresh tokens and AI credentials
- Gemini organization key if centrally provided
- collaboration JWT signing secret
- ERP webhook secret and SMTP credentials
- backup encryption key

Use server-side sessions with `HttpOnly`, `Secure`, and appropriate `SameSite` cookies. Revoke sessions immediately after logout, password change, account deactivation, or administrator removal.

## 5. Reconnect Google Drive on the new domain

1. Register `https://<company-domain>/api/google/oauth/callback` as the exact redirect URI.
2. Register only `https://<company-domain>` as the JavaScript origin.
3. Store Client ID/Secret on the server and encrypt the refresh token at rest.
4. Verify administrator connect, disconnect, account replacement, permission revocation, and reconnect flows.
5. Upload from every evidence category and compare the Drive file/folder, uploader, upload time, SHA-256, project ID, and database metadata.
6. Keep the Drive source private; do not enable public links by default.

## 6. Activate Yjs/Hocuspocus collaboration

The browser collaboration bridge already exists. Complete these server tasks:

1. Apply `server-kit/migrations/001_collaboration_documents.sql`.
2. Deploy `server-kit/collaboration-server` with Node.js 22 or newer.
3. Implement authenticated `POST /api/collaboration/token` using the example service.
4. Issue a document-scoped JWT with a maximum five-minute lifetime only after checking account status, organization, project assignment, document permission, and final-lock status.
5. Recheck the same claims in Hocuspocus `onAuthenticate`.
6. Persist the exact Yjs binary in PostgreSQL and keep Tiptap JSON/version snapshots as the auditable business record.
7. Proxy `/collaboration` as WebSocket and reject unapproved Origins.
8. Publish `/runtime-config.js` with service URLs only:

```js
window.__CLAIM_CENTER_COLLABORATION_URL__ = 'wss://<company-domain>/collaboration';
window.__CLAIM_CENTER_COLLABORATION_TOKEN_ENDPOINT__ = '/api/collaboration/token';
window.__CLAIM_CENTER_RHWP_STUDIO_URL__ = 'https://<company-domain>/rhwp-studio';
```

Never place a token or secret in that public file.

## 7. Document output and HWP/HWPX

- Tiptap JSON is the editing source of truth.
- HWP/HWPX and DOCX are imported/exported deliverables, not the real-time collaboration state.
- Allow HWP/HWPX export only after an approved original template has been imported.
- Keep template ID, output file ID, version, SHA-256, author, and timestamp in PostgreSQL.
- Use Gotenberg for controlled PDF and A4 schedule output. If Gotenberg is unavailable, editing and database saving must continue.
- Verify font, size, margins, headers/footers, tables, images, cover, table of contents, and chapter order against the approved template.

## 8. AI, privacy, and memory

- Send only the minimum authorized project evidence to the configured model.
- Do not log customer source files, full prompts containing confidential evidence, API keys, tokens, or model responses containing personal data.
- Keep personal Gemini keys encrypted per user and organization keys encrypted separately.
- LangGraph flow: evidence readiness → outline → chapter draft → human review → final confirmation.
- Mem0 stores only short reusable writing-rule candidates extracted from human corrections.
- A memory is unusable until an administrator marks it `APPROVED`.
- Hermes is an optional private analysis adapter; it never replaces application authorization or the PostgreSQL approval ledger.

## 9. Health, backup, and recovery

- `/health` checks process survival only.
- `/readiness` checks PostgreSQL, required migrations, storage, and mandatory dependencies.
- Create encrypted daily PostgreSQL backups and continuous WAL retention.
- Include encrypted OAuth/AI credential records, audit logs, document versions, and collaboration state in the backup scope.
- Perform a restore drill on an empty server. A backup is considered valid only after login, project lookup, Drive metadata lookup, and report/proposal resume all succeed.

## 10. Mandatory acceptance tests

The following are release blockers:

1. Approved user login succeeds on another PC; inactive and unapproved users are rejected.
2. Intake file → Gemini summary → saved intake → proposal selection works without data loss.
3. Proposal chapters 1–3 draft → human edit → full preview → confirm → HWP/HWPX/DOCX/PDF export succeeds.
4. An unawarded project never appears in the execution schedule; award confirmation creates the project and opens schedule setup.
5. PM and six-stage dates save correctly, and edits from the schedule or individual workflow pages synchronize both ways.
6. Kickoff/site-survey/evidence uploads reach the correct private Drive folder with uploader and date metadata.
7. Report outline → chapter draft → human edit → save → leave page → resume restores the exact version.
8. Two approved accounts edit the same document simultaneously; edits and carets appear within one second and silent overwrite count is zero.
9. Refresh and Hocuspocus restart restore the same document from PostgreSQL.
10. Other-organization, unassigned, inactive, and read-only users are denied correctly.
11. Final confirmation immediately locks the document, including already-open tabs.
12. Hocuspocus, Gotenberg, and AI outages show honest status and preserve allowed fallback saving.
13. Restore drill reproduces users, projects, evidence metadata, document versions, and audit records.

## 11. Required delivery evidence

Return all of the following to CONCOST:

- source commit IDs and deployment manifest
- architecture diagram and private-network port list
- PostgreSQL schema and D1-to-PostgreSQL mapping
- API inventory with pass/fail status
- environment-variable inventory containing names only
- migration row-count and SHA-256 report
- two-account collaboration recording/screenshots
- access-denied and final-lock evidence
- HWP/HWPX/DOCX/PDF comparison evidence
- backup and restore-drill report
- known limitations and remaining operational risks

Production cutover is approved only after every blocker is passed and reviewed by CONCOST.
