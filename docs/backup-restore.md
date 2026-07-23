# Backup và restore

## Mục tiêu vận hành

Chủ hệ thống phải phê duyệt RPO/RTO trước go-live. Giá trị khởi đầu đề xuất:

- PostgreSQL: RPO 15 phút, RTO 4 giờ.
- Evidence/export: RPO 24 giờ, RTO 8 giờ.
- Restore drill: hàng quý và sau thay đổi lớn về schema/storage.

## PostgreSQL

1. Bật backup/PITR phù hợp plan Railway production.
2. Theo dõi dung lượng volume, thời gian lưu và tình trạng backup hàng ngày.
3. Trước release rủi ro cao, tạo thêm logical backup bằng `pg_dump` từ private runner;
   mã hóa file và đặt trong kho backup tách biệt.
4. Không đưa dump vào Git, artifact CI công khai hoặc laptop cá nhân.

Quy trình PITR:

1. Ghi thời điểm sự cố theo UTC và dừng các mutation nhạy cảm.
2. Tạo PITR fork tại thời điểm trước sự cố.
3. Chạy migration status, kiểm tra row count, tổng payroll và sample cross-branch.
4. Chạy smoke test bằng staging web kết nối fork.
5. Được hai người phê duyệt trước khi chuyển production.
6. Giữ database cũ read-only trong thời hạn điều tra; ghi audit của thao tác khôi phục.

Railway PITR tạo một volume fork; không tự động thay thế nguồn hiện tại:
[Point-in-time recovery](https://docs.railway.com/volumes/point-in-time-recovery).

## Object storage

- Bucket luôn private; bật retention/versioning theo khả năng của plan.
- Evidence nghiệp vụ cần thời hạn theo chính sách công ty/pháp lý; export tạm mặc định 30
  ngày và được cleanup job xóa.
- Backup metadata database và object phải cùng mốc đủ gần để phát hiện object mồ côi.
- Restore drill phải kiểm tra checksum SHA-256, MIME, kích thước và authorization signed URL.

## Checklist restore drill

- [ ] Restore vào environment cô lập, không ghi đè production.
- [ ] Migration status sạch.
- [ ] Đăng nhập GM và manager hoạt động.
- [ ] Manager A không đọc record/file branch B.
- [ ] Payroll snapshot/hash và tổng tiền khớp.
- [ ] Evidence tải được qua signed URL ngắn hạn.
- [ ] Worker xử lý một export và dead-letter queue trống.
- [ ] Ghi thời gian thực tế, lỗi và hành động khắc phục.
