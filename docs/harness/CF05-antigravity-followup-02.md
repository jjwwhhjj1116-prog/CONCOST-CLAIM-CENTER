# CF05 Antigravity Follow-up 02 — Company Google OAuth completion

## Current verified baseline

- GitHub branch: `feat/CF05-google-drive-sync`
- Cloudflare production URL: `https://concost-claim-center-preview.jjwwhhjj1116.workers.dev`
- Production build source and command are `feat/CF05-google-drive-sync` + `pnpm run build`.
- Cloudflare D1 migrations `0000` through `0004` are applied; existing users and sessions remain available.
- R2 remains `SKIPPED_BY_USER`. Do not create an R2 bucket or request payment.
- Login without a session returns HTTP 401 and one workbook member credential was verified through the real login screen.
- A personal Google Cloud project was explored but must not be used for the production connection. Complete OAuth under the company-managed Google Workspace account.
- Cloudflare runtime already contains the exact OAuth redirect origin and an encrypted credential master key.
- The application restricts connections to `@con-cost.com`, always shows Google's account chooser, and lets an Admin replace or disconnect the linked company account at any time.

## Required next actions

1. Sign in to Google Cloud with an authorized `@con-cost.com` company account. Do not continue with the previously opened personal-account project.
2. In the company Google Cloud project, the user must personally accept the Google API Services User Data Policy. Do not accept legal terms on the user's behalf.
3. Finish the External testing consent configuration and add the intended company administrator Google account as a test user.
4. Create a Web application OAuth client named `Claim Center Studio Cloudflare`.
5. Configure the exact redirect URI:
   `https://concost-claim-center-preview.jjwwhhjj1116.workers.dev/api/google/oauth/callback`
6. Store the generated client ID and client secret only as Cloudflare production secrets named `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Never paste either value into Git, logs, screenshots, D1, review documents, or chat output.
7. Verify live production behavior using the deployed site:
   - member login is required;
   - Admin can complete Google consent;
   - Drive folder binding succeeds;
   - one synthetic file can be dragged/dropped, uploaded, listed, downloaded, and hash-checked;
   - D1 stores metadata only and the Drive file remains after browser restart;
   - non-Admin users cannot see Admin-only configuration;
   - assigned Staff/Reviewer access follows the product RBAC contract;
   - duplicate retry creates no duplicate Drive file;
   - `다른 회사 Google 계정으로 변경` always displays the Google account chooser;
   - a non-`@con-cost.com` account is rejected;
   - switching credentials removes only case-folder bindings and never deletes evidence metadata;
   - old Drive objects remain externally intact; access continues only when they are shared or migrated to the new company account;
   - the old credential is retired after a successful switch, while a failed switch revokes the newly issued credential;
   - disconnect/reconnect and reconciliation paths remain fail-closed.
8. Redact account identifiers, folder IDs, OAuth codes, tokens, secrets, and employee credentials from all submitted evidence.
9. Run the full CF05 and regression gates. Update evidence with actual counts and the exact Git commit; do not claim PASS until live Google OAuth, upload, download, account replacement, and folder rebind have been exercised.

## Explicit prohibitions

- Do not reintroduce fake Google file IDs or `ALLOW_TEST_GOOGLE_MODES` in production.
- Do not use R2, Render, local filesystem persistence, or D1 blobs for file contents.
- Do not bypass the login screen.
- Do not connect a personal Google account to production.
- Do not commit or log raw client secrets, access tokens, refresh tokens, authorization codes, workbook passwords, personal phone numbers, or email lists.
- Do not advance CF05 to PASS merely because mocked tests pass.

## Completion handback

Return a fresh review request containing the implementation/evidence commit IDs, live deployment URL, redacted OAuth/upload/download/account-switch proof, D1 metadata proof, Drive object proof, full gate counts, and any remaining external Google verification limitation.
