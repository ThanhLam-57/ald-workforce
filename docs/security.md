# Security model

## Quyền và chống IDOR

Mọi service lấy `companyId`, role và danh sách branch đang hiệu lực từ session. ID hoặc
`branchId` do client gửi chỉ là selector và luôn được ràng buộc lại bằng server scope.
Training Manager chỉ được truy cập branch được phân công; employee chỉ xem dữ liệu đã
publish của chính mình. Export/query/file dùng cùng authorization với màn hình.

DTO loại trường nhạy cảm ở server. Employee error report không query/serialize revenue.
Response có session scope dùng `private, no-store`.

## Authentication

- Better Auth database session, cookie `HttpOnly`, `SameSite=Lax`, `Secure` ở production.
- CSRF/origin check từ Better Auth và proxy same-origin cho mọi mutation `/api`.
- Signup công khai bị tắt; chỉ GM có permission tạo account.
- Password 12–128 ký tự, bắt buộc hoa/thường/số/ký tự đặc biệt, không khoảng trắng.
- Account mới có `mustChangePassword`; mọi API nghiệp vụ trả
  `PASSWORD_CHANGE_REQUIRED` cho đến khi đổi. Đổi password thu hồi session khác.
- Login, 2FA và mutation nhạy cảm dùng PostgreSQL-backed rate limit.
- GM có thể bật TOTP 2FA; verification có account lockout và backup code.

Secret không được log. Mỗi environment có auth/storage/metrics secret riêng và phải rotate
khi nghi ngờ lộ. Không đặt secret thật trong `.env.example`, CI log hoặc audit before/after.

## Upload, download và export

- Bucket private; presigned PUT/GET ngắn hạn chỉ tạo sau authorization.
- Upload kiểm tra allow-list MIME, kích thước, checksum và xác minh object bằng HEAD.
- Audit sensitive download cho payroll/evidence.
- CSV/XLSX chống formula injection với các giá trị bắt đầu `=`, `+`, `-`, `@`.
- Tên file/object key do server tạo; không dùng path do client truyền.

## HTTP và observability

Security headers gồm CSP, HSTS, frame denial, nosniff, referrer và permissions policy.
Request có `x-request-id`; structured log chỉ chứa requestId, userId, branch scope, role và
event kỹ thuật. Không log password, cookie, token, presigned URL hoặc nội dung payroll.
Metrics production yêu cầu bearer token.

## RLS

PostgreSQL RLS đã được cân nhắc nhưng chưa bật. Prisma dùng connection pool và hiện chưa
bọc toàn bộ request trong một transaction có `SET LOCAL` tenant/branch context được chứng
minh bằng integration tests. Bật RLS lúc này có thể tạo cảm giác an toàn giả hoặc rò context
giữa connection. Application authorization vẫn là lớp chính; RLS chỉ được thêm sau khi có
request-scoped transaction cho mọi query, fail-closed defaults và test IDOR chạy qua pool.

## Review trước release

- [ ] IDOR company/branch và direct file ID.
- [ ] Mass assignment: Zod projection và explicit service fields.
- [ ] Origin/CSRF, cookie flags, session revoke.
- [ ] Rate limit login, 2FA, user/rule/payroll/import mutations.
- [ ] Evidence MIME/size/checksum/signed URL TTL.
- [ ] CSV/XLSX formula injection.
- [ ] No secret/revenue/payroll leakage trong logs và exports.
- [ ] Dependency/container scan và secret scan.
