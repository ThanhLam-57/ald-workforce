# Hướng dẫn Tổng quản lý

## Khởi tạo

1. Tạo branch và hồ sơ staff.
2. Gán manager vào đúng branch với effective date.
3. Tạo account từ màn hình quản trị; gửi username và mật khẩu đăng nhập qua hai kênh tách biệt.
4. Khuyến nghị người dùng chủ động đổi mật khẩu trong mục **Bảo mật tài khoản**.
5. GM bật TOTP 2FA trong mục **Bảo mật tài khoản** và lưu backup codes ngoại tuyến.

Không dùng chung account, không gửi password qua audit note và không tạo account trực tiếp
trong database.

## Rule và payroll

- Rule đã publish là immutable; thay đổi bằng clone draft, preview impact và effective date.
- Không cho effective interval overlap.
- Violation snapshot item/version/amount tại ngày xảy ra; override cần reason.
- Payroll: tạo period → calculate → review → lock → publish. Sau lock chỉ adjustment/revision
  có reason và audit; không sửa snapshot cũ.
- Kiểm tra anomaly, totals, rule version và employee count trước lock.

## Vận hành

- Dashboard và `GET /api/operations/jobs` hiển thị queue/export/dead-letter.
- Job dead-letter phải được điều tra trước khi retry thủ công.
- Audit export dành cho điều tra, không chỉnh/xóa audit record.
- Khi offboard: kết thúc assignment/employment theo effective date, disable account và revoke
  sessions; không hard-delete lịch sử.
- Signed URL payroll/evidence không được chuyển tiếp ra ngoài phạm vi người nhận.

## Sự cố

Khi nghi lộ account: disable account, revoke sessions, rotate password/auth secret nếu cần,
kiểm tra audit sensitive reads/downloads và ghi incident timeline theo UTC. Sự cố dữ liệu làm
theo [backup/restore](backup-restore.md); sự cố release làm theo
[Railway deployment](deployment-railway.md).
