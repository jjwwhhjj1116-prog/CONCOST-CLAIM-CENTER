# CONCOST Claim Center — Vietnam Full Source Package

This package contains the complete Git-tracked source at the release commit, the current requested `dev.db` snapshot, database migrations, and server handoff instructions.

## Read this first

1. Check `RELEASE_INFO.txt` and `SHA256SUMS.txt` before deployment.
2. The complete source is under `source/`.
3. The requested SQLite snapshot is under `server-data/dev.db`.
4. For a brand-new server only, copy that file to the production data path before the first start.
5. For an existing server, **do not overwrite the production `dev.db`**. Keep the existing database and follow `source/docs/runbooks/vietnam-weekly-sqlite-update.md` to apply only new migrations.
6. Keep the existing production `.env`, Google credential vault, uploads, backup store, `AI_CREDENTIAL_MASTER_KEY`, and `GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY`.
7. Never run `pnpm db:reset` against a database that must retain data.
8. Cloudflare D1 migrations and Node/SQLite migrations are separate. Check and apply the correct set for the target runtime.
9. Values in `source/wrangler.jsonc` identify the Cloudflare preview environment. Do not reuse its D1 ID, preview domain or allowed-account values as the company-server production configuration.

## Required deployment verification

- Install with the locked `pnpm-lock.yaml`.
- Build the web and API from this package.
- Back up and verify the target database before migration.
- Stop all SQLite writers before running `pnpm db:migrate` with an absolute existing `DATABASE_URL`.
- Start the API and require `/readiness` HTTP 200.
- Test login, administrator settings, Google Drive, AI credential status, proposal/report editing, and final document export.

## Lưu ý cho đội phát triển Việt Nam

- `source/` là toàn bộ mã nguồn tại commit phát hành.
- `server-data/dev.db` là bản SQLite theo yêu cầu, chỉ dùng để khởi tạo máy chủ mới.
- Nếu máy chủ đã có dữ liệu, tuyệt đối không chép đè `dev.db`; hãy giữ DB hiện tại và chỉ chạy migration mới theo tài liệu `vietnam-weekly-sqlite-update.md`.
- Giữ nguyên `.env`, credential vault, uploads và các master key trên máy chủ.
- Không chạy `pnpm db:reset` trên DB cần bảo toàn dữ liệu.
- Sau khi cập nhật phải kiểm tra `/readiness`, đăng nhập, cấu hình quản trị, Google Drive, AI và xuất tài liệu.

## 한국어 요약

- `source/`에는 배포 커밋의 전체 추적 소스가 들어 있습니다.
- `server-data/dev.db`는 요청에 따라 포함한 SQLite 파일이며 신규 서버 최초 구성에만 사용합니다.
- 이미 운영 DB가 있으면 이 파일로 덮어쓰지 말고 기존 DB에 새 migration만 적용합니다.
- `.env`, Google credential vault, 업로드, 암호화 master key는 기존 서버 값을 유지합니다.
- 적용 전 백업 검증, 적용 후 `/readiness` 및 핵심 업무 기능 검수가 필수입니다.
