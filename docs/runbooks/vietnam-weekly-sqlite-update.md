# Vietnam Server Weekly SQLite Update Protocol

This runbook applies when the Vietnam team receives a new weekly source revision while keeping the existing SQLite `dev.db` and administrator integrations.

## 1. What must remain on the server

- `packages/database/.data/dev.db`
- the production `.env` or secret-manager values
- `AI_CREDENTIAL_MASTER_KEY` and Google credential master key
- uploaded files and backup directories

Do not copy these files from the source package and do not commit them to Git. Replacing `dev.db` or changing an encryption master key can make existing users, OAuth refresh tokens, AI credentials, and administrator settings unavailable.

## 2. What each weekly source delivery must contain

- Git branch, release tag or commit SHA
- changed-file summary
- new SQLite migrations under `packages/database/prisma/migrations/`
- new Cloudflare D1 migrations under `apps/cloudflare/migrations/`, when applicable
- migration test result against a populated database copy
- build and regression-test result
- rollback notes

Never edit a migration that is already recorded in `_P04Migration`. Add a new timestamped migration instead.

## 3. Safe update procedure

1. Put the application in maintenance mode and block new writes.
2. Use the administrator backup engine (`/api/admin/backup/create` and `/api/admin/backup/verify`) to create and verify a signed backup package. Record its backup ID and keep a second copy outside the application host.
3. Stop the API and every process that can write to SQLite. Preserve `dev.db`, uploads, the Google credential vault, and the secret-manager configuration.
4. Record the current source commit, the exact absolute DB path, the current `_P04Migration` rows, table row counts and critical setting IDs.
5. Restore the verified backup to an isolated path. Run the real migration runner against this populated copy first, then verify `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, the exact migration ledger, table row counts and critical records.
6. Install the locked dependencies and build the source. Only after the populated-copy test passes, point `DATABASE_URL` at the existing production file and run the additive migration command:

   ```bash
   DATABASE_URL='file:/absolute/server/path/dev.db' corepack pnpm db:migrate
   ```

   Never omit `DATABASE_URL` in production. If the exact file does not already exist, stop instead of creating a new database.

7. Never run `pnpm db:reset` or a synthetic seed against the preserved server database.
8. Start the server and verify:
   - `PRAGMA integrity_check` returns `ok`;
   - every migration name/checksum is present in `_P04Migration`;
   - pre-existing user, project, proposal, report and administrator-setting rows remain;
   - login, administrator settings, Google Drive status and AI credential status load correctly;
   - `/readiness` (or `/api/readiness`) returns HTTP 200 and reports that migrations are up to date.

## 4. Failure and rollback

If a migration, integrity check or smoke test fails, stop the server, restore the verified pre-update backup, restore the previous source commit and investigate on a copied database. Do not invent reverse SQL, delete the database, edit the failed migration in place or retry against the only production copy. Record the restore result and recovery time.

## 5. Current repository behavior

The Node/SQLite runtime already uses `packages/database/src/db-engine.ts`. It stores applied migration names and SHA-256 checksums in `_P04Migration`, applies only pending migrations in order and rejects a changed checksum. The default DB path is `packages/database/.data/dev.db`, which is excluded by `.gitignore`.

The current runner loads the whole database into memory and writes the exported file back at the end. It does not automatically enforce maintenance mode, signed backup verification, an existing-file guard or an atomic replacement. Therefore it must not run concurrently with the API. The stop/backup/populated-copy procedure above is mandatory until those safeguards are implemented in the runner.

Cloudflare Preview uses a different database engine, D1, and its migrations are in `apps/cloudflare/migrations/`. A schema change used by both runtimes requires two compatible migrations; a D1 migration alone does not update the Vietnam SQLite server.

## 6. Vietnamese summary / Tóm tắt tiếng Việt

- Giữ nguyên `dev.db` và các secret trên máy chủ; không chép đè từ gói source.
- Mỗi thay đổi schema phải có migration mới; không sửa migration đã áp dụng.
- Sao lưu DB và secret trước khi chạy `pnpm db:migrate`.
- Tạo và xác minh gói backup có chữ ký, sau đó thử migration trên bản sao có dữ liệu trước khi áp dụng vào DB thật.
- Dừng hoàn toàn API và chỉ định `DATABASE_URL` tuyệt đối trỏ tới file đang tồn tại.
- Tuyệt đối không chạy `pnpm db:reset` trên DB có dữ liệu.
- Sau migration phải kiểm tra integrity, checksum, số lượng bản ghi, đăng nhập, Google Drive và trạng thái AI credential.
- Nếu migration lỗi, khôi phục bản sao lưu và kiểm tra trên bản sao DB, không xóa DB hiện tại.
