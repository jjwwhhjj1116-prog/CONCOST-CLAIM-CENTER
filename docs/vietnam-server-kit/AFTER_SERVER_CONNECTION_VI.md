# CONCOST Claim Center — Chỉ thị sau khi kết nối máy chủ công ty

Phiên bản: 2026-08-25
Đối tượng: Kỹ sư backend, hạ tầng, cơ sở dữ liệu và QA tại Việt Nam

Tài liệu này được thực hiện **sau khi máy chủ công ty, tên miền, chứng chỉ TLS và mạng riêng đã sẵn sàng**. Không được báo hoàn thành chỉ vì trang web có thể mở. Cloudflare Preview hiện tại vẫn là chuẩn đối chiếu chức năng cho đến khi toàn bộ kiểm thử nghiệm thu dưới đây đạt yêu cầu.

## 1. Kiến trúc mục tiêu

Định tuyến một HTTPS origin qua Nginx hoặc Caddy:

- `/` và `/assets/*` → ứng dụng React đã build
- `/api/*`, `/auth/*`, `/health`, `/readiness` → Node.js application API
- `/collaboration/*` → Hocuspocus WebSocket

PostgreSQL, Redis, Hocuspocus, Gotenberg, Mem0/LangGraph/Hermes và dịch vụ sao lưu phải nằm trong mạng riêng. Không mở các cổng dịch vụ này trực tiếp ra Internet.

## 2. Chuyển toàn bộ application API

Hợp đồng workflow mới nhất nằm trong `apps/cloudflare/src/index.ts` và các migration Cloudflare từ `0001` đến `0043`. `apps/api/src/server.ts` chỉ là nền Node/SQLite cũ và **không phải** backend thay thế đầy đủ.

Phải chuyển toàn bộ endpoint hiện tại và giữ nguyên JSON request/response, HTTP status, error code, session, optimistic version check, role check và audit record. Các mô-đun bắt buộc:

1. Đăng nhập, session, phê duyệt người dùng, đổi mật khẩu, role và tài khoản quản trị
2. Tiếp nhận dự án, file đính kèm, Gemini tóm tắt hồ sơ và kho lưu trữ hồ sơ tiếp nhận
3. Template đề xuất, quy tắc prompt, AI draft, chỉnh sửa thủ công, preview cuối, xác nhận, export, DB archive và quyết định trúng thầu
4. Xác nhận dự án, ERP bridge, phân công PM, lịch sáu giai đoạn, đồng bộ lịch hai chiều và phê duyệt thay đổi
5. Họp khởi động, khảo sát hiện trường, hồ sơ khối lượng/chi phí, loại chứng cứ, Google Drive, người upload, thời gian và SHA-256
6. Template báo cáo, mục lục, prompt theo chương, AI draft, chỉnh sửa, autosave, tiếp tục công việc, phê duyệt, bản cuối và archive
7. Hồ sơ tòa án, lịch tố tụng, quản lý sau bàn giao, thông báo, cài đặt, hướng dẫn và audit history

Mọi organization ID, project ID, case ID, document ID và user ID do trình duyệt gửi lên phải được xác minh lại từ session đã xác thực trên máy chủ.

## 3. Chuyển schema và dữ liệu D1 sang PostgreSQL

Áp dụng migration PostgreSQL đã được review, không chạy trực tiếp SQL của SQLite.

- Giữ nguyên foreign key, unique constraint, soft-delete, version guard và audit history.
- Chuyển cột chuỗi JSON sang `jsonb` sau khi kiểm tra hợp lệ.
- Chuyển các thao tác D1 `batch()` thành PostgreSQL transaction.
- Không được mất Tiptap JSON, Markdown snapshot, chương đề xuất, phiên bản prompt, document revision, Drive metadata và final lock.
- So sánh row count và số phiên bản tài liệu giữa nguồn và đích.
- Nếu chuyển dữ liệu production, phải nộp báo cáo migration theo từng bảng và bằng chứng SHA-256.

Không tắt hoặc xóa Cloudflare Preview trước khi hoàn tất xác minh dữ liệu và nghiệm thu nghiệp vụ.

## 4. Xác thực và Secret

Giá trị thật chỉ được lưu trong secret manager hoặc môi trường được bảo vệ của máy chủ. Tuyệt đối không commit vào Git, `/runtime-config.js`, frontend asset, log, ảnh chụp hoặc ticket hỗ trợ.

Nhóm Secret bắt buộc gồm:

- kết nối database và Redis
- session cookie secret
- Google OAuth Client ID và Client Secret
- khóa mã hóa Google refresh token và AI credential
- Gemini organization key nếu công ty cấp chung
- collaboration JWT signing secret
- ERP webhook secret, SMTP credential và backup encryption key

Sử dụng session phía máy chủ với cookie `HttpOnly`, `Secure` và `SameSite` phù hợp. Phải revoke session ngay khi logout, đổi mật khẩu, vô hiệu hóa tài khoản hoặc quản trị viên xóa quyền.

## 5. Kết nối lại Google Drive cho tên miền mới

1. Đăng ký chính xác `https://<company-domain>/api/google/oauth/callback` làm redirect URI.
2. Chỉ đăng ký `https://<company-domain>` làm JavaScript origin.
3. Lưu Client ID/Secret trên máy chủ và mã hóa refresh token khi lưu trữ.
4. Kiểm thử kết nối, ngắt kết nối, đổi tài khoản, thu hồi quyền và kết nối lại trong màn hình quản trị.
5. Upload từ mọi loại chứng cứ; đối chiếu file/folder Drive, người upload, thời gian, SHA-256, project ID và metadata trong DB.
6. Drive phải ở chế độ private; không tự động tạo public link.

## 6. Kích hoạt cộng tác Yjs/Hocuspocus

Bridge phía trình duyệt đã có sẵn. Nhóm máy chủ phải hoàn thành:

1. Áp dụng `server-kit/migrations/001_collaboration_documents.sql`.
2. Deploy `server-kit/collaboration-server` bằng Node.js 22 trở lên.
3. Tích hợp `POST /api/collaboration/token` có xác thực theo file ví dụ.
4. Chỉ cấp JWT theo từng tài liệu, tối đa năm phút, sau khi kiểm tra trạng thái tài khoản, tổ chức, phân công dự án, quyền tài liệu và final lock.
5. Kiểm tra lại các claim tương tự trong Hocuspocus `onAuthenticate`.
6. Lưu nguyên Yjs binary trong PostgreSQL; Tiptap JSON và version snapshot vẫn là hồ sơ nghiệp vụ có thể audit.
7. Proxy `/collaboration` bằng WebSocket và từ chối Origin không được phép.
8. Public `/runtime-config.js` chỉ được chứa URL dịch vụ:

```js
window.__CLAIM_CENTER_COLLABORATION_URL__ = 'wss://<company-domain>/collaboration';
window.__CLAIM_CENTER_COLLABORATION_TOKEN_ENDPOINT__ = '/api/collaboration/token';
window.__CLAIM_CENTER_RHWP_STUDIO_URL__ = 'https://<company-domain>/rhwp-studio';
```

Không được đặt token hoặc Secret trong file public này.

## 7. Xuất tài liệu và HWP/HWPX

- Tiptap JSON là nguồn dữ liệu chỉnh sửa chuẩn.
- HWP/HWPX và DOCX là file import/export cuối, không phải trạng thái cộng tác thời gian thực.
- Chỉ cho phép export HWP/HWPX sau khi đã import template gốc được phê duyệt.
- Lưu template ID, output file ID, version, SHA-256, tác giả và thời gian trong PostgreSQL.
- Dùng Gotenberg cho PDF và lịch A4. Nếu Gotenberg lỗi, chức năng chỉnh sửa và lưu DB vẫn phải hoạt động.
- Đối chiếu font, cỡ chữ, lề, header/footer, bảng, ảnh, trang bìa, mục lục và thứ tự chương với template đã duyệt.

## 8. AI, bảo mật dữ liệu và bộ nhớ

- Chỉ gửi lượng chứng cứ tối thiểu đã được cấp quyền tới model đã cấu hình.
- Không ghi log file nguồn của khách hàng, prompt đầy đủ chứa chứng cứ mật, API key, token hoặc model response có dữ liệu cá nhân.
- Mã hóa Gemini key cá nhân theo từng người dùng và organization key riêng biệt.
- Luồng LangGraph: kiểm tra chứng cứ → mục lục → draft theo chương → người kiểm tra → xác nhận cuối.
- Mem0 chỉ lưu ứng viên quy tắc viết ngắn được trích xuất từ thay đổi do con người thực hiện.
- Memory không được sử dụng trước khi quản trị viên đặt trạng thái `APPROVED`.
- Hermes chỉ là adapter phân tích nội bộ tùy chọn; không được thay thế authorization của ứng dụng hoặc sổ phê duyệt PostgreSQL.

## 9. Health, sao lưu và khôi phục

- `/health` chỉ kiểm tra process còn sống.
- `/readiness` kiểm tra PostgreSQL, migration bắt buộc, storage và dependency thiết yếu.
- Tạo PostgreSQL backup mã hóa hằng ngày và lưu WAL liên tục.
- Phạm vi backup phải gồm OAuth/AI credential đã mã hóa, audit log, document version và collaboration state.
- Thực hiện restore drill trên máy chủ trống. Backup chỉ được coi là hợp lệ khi đăng nhập, tra dự án, tra Drive metadata và tiếp tục báo cáo/đề xuất đều thành công.

## 10. Kiểm thử nghiệm thu bắt buộc

Các mục sau là release blocker:

1. Tài khoản đã duyệt đăng nhập được từ PC khác; tài khoản chưa duyệt hoặc bị vô hiệu hóa phải bị từ chối.
2. File tiếp nhận → Gemini tóm tắt → lưu hồ sơ → chọn trong đề xuất hoạt động và không mất dữ liệu.
3. AI draft chương 1–3 của đề xuất → chỉnh sửa → full preview → xác nhận → export HWP/HWPX/DOCX/PDF thành công.
4. Dự án chưa trúng thầu không xuất hiện trong lịch; xác nhận trúng thầu phải tạo dự án và mở màn hình lập lịch.
5. PM và ngày của sáu giai đoạn lưu đúng; sửa từ lịch hoặc màn hình workflow riêng phải đồng bộ hai chiều.
6. File họp khởi động, khảo sát và chứng cứ được đưa vào đúng thư mục Drive private với người upload và ngày.
7. Mục lục báo cáo → draft chương → chỉnh sửa → lưu → rời trang → tiếp tục phải khôi phục đúng phiên bản.
8. Hai tài khoản đã duyệt cùng sửa một tài liệu; nội dung và con trỏ xuất hiện trong một giây, số lần ghi đè âm thầm bằng 0.
9. Refresh trình duyệt và restart Hocuspocus phải khôi phục cùng tài liệu từ PostgreSQL.
10. Người dùng khác tổ chức, chưa được phân công, bị vô hiệu hóa hoặc chỉ có quyền đọc phải bị chặn đúng.
11. Xác nhận cuối phải khóa tài liệu ngay, kể cả tab đã mở trước đó.
12. Khi Hocuspocus, Gotenberg hoặc AI lỗi, UI phải hiển thị trạng thái trung thực và vẫn giữ đường lưu fallback được phép.
13. Restore drill phải phục hồi đúng người dùng, dự án, evidence metadata, document version và audit record.

## 11. Bằng chứng phải bàn giao

Gửi lại cho CONCOST toàn bộ:

- source commit ID và deployment manifest
- sơ đồ kiến trúc và danh sách cổng mạng riêng
- PostgreSQL schema và bảng ánh xạ D1 sang PostgreSQL
- API inventory kèm kết quả pass/fail
- danh sách tên biến môi trường, không chứa giá trị Secret
- báo cáo row count và SHA-256 của migration
- video/ảnh hai tài khoản cộng tác
- bằng chứng từ chối truy cập và final lock
- bằng chứng so sánh HWP/HWPX/DOCX/PDF
- báo cáo backup và restore drill
- giới hạn còn lại và rủi ro vận hành

Chỉ được chuyển sang production sau khi toàn bộ release blocker đạt yêu cầu và được CONCOST review.
