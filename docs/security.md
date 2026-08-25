# Security model

## Quyền và chống IDOR

Mọi service lấy `companyId`, role và danh sách branch đang hiệu lực từ session. ID hoặc
`branchId` do client gửi chỉ là selector và luôn được ràng buộc lại bằng server scope.
Training Manager chỉ được truy cập branch được phân công; employee chỉ xem dữ liệu đã
publish của chính mình. Export/query/file dùng cùng authorization với màn hình.

### Ma trận Training Manager

| Route                                             | Quyền                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `/dashboard`                                      | Chỉ số vận hành của tất cả cơ sở đang được phân công; không có payroll             |
| `/attendance`                                     | Đọc/sửa nhân viên Live trong cơ sở được phân công; không sửa bản thân hoặc manager |
| `/branch-overview`                                | Chỉ xem; không sửa và không export                                                 |
| `/company-report`                                 | Chỉ xem projection vận hành theo scope; DTO không chứa lương/payroll               |
| `/manager-kpi`                                    | Chỉ KPI bản thân đã publish khi company setting bật                                |
| `/rules`                                          | Chỉ xem quy định hiện hành; không mutation/version editor                          |
| `/payroll`, `/data-governance`, `/administration` | Bị chặn ở page, API và service                                                     |

Cờ `canManagePayroll` cũ không cấp quyền cho `TRAINING_MANAGER`. Chỉ
`GENERAL_MANAGER` được gọi payroll service/API/export.

DTO loại trường nhạy cảm ở server. Employee error report không query/serialize revenue.
Response có session scope dùng `private, no-store`.

## Authentication

- Better Auth database session, cookie `HttpOnly`, `SameSite=Lax`, `Secure` ở production.
- CSRF/origin check từ Better Auth và proxy same-origin cho mọi mutation `/api`.
- Signup công khai bị tắt; chỉ GM có permission tạo account.
- Password 12–128 ký tự, bắt buộc hoa/thường/số/ký tự đặc biệt, không khoảng trắng.
- Account mới dùng ngay mật khẩu do GM cấp và không bị ép đổi ở lần đăng nhập đầu tiên.
  Người dùng vẫn có thể chủ động đổi mật khẩu; thao tác này thu hồi các session khác.
- GM phải chuyển mật khẩu khởi tạo qua kênh riêng và không lưu mật khẩu trong audit hoặc log.
- Login, 2FA và mutation nhạy cảm dùng PostgreSQL-backed rate limit.
- GM có thể bật TOTP 2FA; verification có account lockout và backup code.

Secret không được log. Mỗi environment có auth/storage/metrics secret riêng và phải rotate
khi nghi ngờ lộ. Không đặt secret thật trong `.env.example`, CI log hoặc audit before/after.

## Upload, download và export

- Bucket private. Upload ảnh đi qua API cùng origin và được authorize lại theo company/branch;
  presigned GET ngắn hạn chỉ tạo khi người dùng có quyền xem.
- Upload giới hạn stream độc lập với `Content-Length`, kiểm tra allow-list MIME, chữ ký file,
  kích thước, checksum và xác minh object bằng HEAD trước khi chuyển sang `READY`.
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
