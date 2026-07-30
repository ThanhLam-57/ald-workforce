# Đặc tả sản phẩm

## 1. Mục tiêu

Xây dựng một nguồn dữ liệu thống nhất cho công ty nhiều cơ sở nhằm quản lý nhân sự, chấm công, hoạt động Live, KPI, doanh số, vi phạm, thưởng và lương. Các bảng giống Excel là view, báo cáo hoặc bản export từ PostgreSQL, không phải nguồn dữ liệu độc lập.

Múi giờ nghiệp vụ là `Asia/Ho_Chi_Minh`; timestamp được lưu UTC. Tiền VND và doanh số nguyên dùng `BIGINT`, thời lượng dùng phút nguyên và số công dùng `Decimal`.

## 2. Vai trò và phạm vi

- `GENERAL_MANAGER` (GM): thao tác trong toàn công ty, quản trị cơ sở/tài khoản/nhân sự, chấm công và KPI quản lý, quản trị rule, payroll, báo cáo và audit.
- `TRAINING_MANAGER` (TM): chỉ làm việc trong các khoảng phân công cơ sở đang hiệu lực; quản lý nhân viên Live, dữ liệu ngày, vi phạm và báo cáo cơ sở; không xem payroll.
- `LIVE_EMPLOYEE`: chỉ đọc dữ liệu của bản thân đã publish nếu self-service được bật; quyền xem doanh số còn phụ thuộc setting công ty.

Job position và auth role là hai khái niệm độc lập. Một nhân sự có thể tồn tại mà không có tài khoản đăng nhập.

## 3. Phạm vi chức năng đích

### 3.1 Nhân sự và tổ chức

- Quản lý công ty, cơ sở, vị trí công việc, nhân sự và tài khoản.
- Lưu lịch sử phân công cơ sở theo khoảng `[effectiveFrom, effectiveTo)`.
- Tách `employmentCategory` (chính thức, thử việc, nghỉ việc...) khỏi `performanceLevel` (khởi động, tiên phong...).
- Lưu lịch sử level theo khoảng hiệu lực, không ghi đè.
- Bật/tắt employee self-service và quyền xem doanh số của bản thân bằng setting công ty.

### 3.2 Hồ sơ ngày/tháng nhân viên Live

- Một attendance day duy nhất trên `staffId + workDate`.
- Check-in/out, phút Live thực tế, phút tăng ca, số công, doanh số, ghi chú và evidence.
- Một ngày có thể có nhiều vi phạm.
- Vi phạm snapshot mã/mô tả/mức phạt/rule version theo ngày phát sinh.
- Bảng tháng theo nhân viên và bảng tổng quan cơ sở cùng đọc/ghi record nguồn; không lưu bảng tổng hợp trùng.
- Export báo lỗi gửi nhân viên được tạo bởi server từ DTO allow-list không có doanh số.

### 3.3 KPI quản lý

- GM nhập attendance cho TM.
- KPI theo tháng dựa trên template versioned gồm tiêu chí, trọng số, thang điểm và ghi chú.
- Bản đánh giá có vòng đời draft/published; bản published không sửa trực tiếp.

### 3.4 Rule

- Rule thưởng ngày, thưởng tháng/level, phạt, salary và KPI template có draft, preview, schedule/publish.
- Rule published bất biến, có khoảng hiệu lực `[effectiveFrom, effectiveTo)` và không overlap trong cùng loại/phạm vi.
- Dropdown vi phạm được suy ra theo rule phạt hiệu lực tại ngày vi phạm.
- Công thức dùng cấu hình có kiểu dữ liệu, không lưu hoặc thực thi JavaScript.

### 3.5 Payroll

- Trạng thái kỳ lương: `DRAFT → CALCULATED → REVIEWED → LOCKED → PUBLISHED`.
- Tính từ attendance, Live metrics, doanh số, vi phạm, level, rule và adjustment.
- Entry gồm breakdown line, source ID, rule version ID và calculation snapshot.
- Kỳ locked/published bất biến; thay đổi bằng adjustment/revision được audit.
- Nhân viên chỉ đọc payslip đã publish của chính mình.

### 3.6 Import, export và audit

- Import XLSX/CSV theo quy trình upload → preview → validate từng dòng → commit idempotent.
- Export XLSX/PDF là job nền khi khối lượng lớn.
- Evidence và file import/export ở private object storage; signed URL ngắn hạn chỉ cấp sau authorize.
- Mutation quan trọng ghi actor, reason khi bắt buộc, before/after, request metadata và thời điểm.

## 4. Màn hình tối thiểu

1. Đăng nhập.
2. Dashboard GM toàn công ty.
3. GM quản lý cơ sở, tài khoản, nhân sự, attendance/KPI quản lý.
4. Dashboard TM theo phạm vi cơ sở.
5. Danh sách và hồ sơ nhân viên.
6. Bảng nhập liệu tháng theo nhân viên.
7. Bảng tổng quan tháng cơ sở dạng spreadsheet và biểu đồ.
8. Rule center và lịch sử phiên bản.
9. Payroll periods, breakdown, review, adjustment, lock, publish, export.
10. Báo cáo toàn công ty.
11. Audit log.
12. Import/export center.
13. Employee self-service read-only khi được bật.

## 5. Yêu cầu phi chức năng

- TypeScript strict, input qua Zod, công thức nghiệp vụ ở `packages/domain`.
- Mọi service/query authorize trên server. Route guard chỉ hỗ trợ UX.
- Query theo cơ sở lấy scope từ session và assignment trong database; bỏ qua `branchId` không thuộc scope dù client gửi.
- Không dùng cache chung cho dữ liệu có scope; mặc định `no-store`.
- Mutation nghiệp vụ dùng transaction và audit trong cùng transaction khi phù hợp.
- Bảng tháng có sticky columns, cuộn ngang, điều hướng bàn phím, trạng thái lưu rõ ràng và
  conflict detection bằng version. Màn `/attendance` chỉ gửi mutation khi người dùng bấm
  `Lưu thay đổi`.
- Có loading, empty, error và permission-denied state.
- Health liveness không phụ thuộc database; readiness kiểm tra dependency bắt buộc.
- Web là service public duy nhất; worker, PostgreSQL và storage là private.

## 6. Phạm vi Prompt 0 / Phase 1

### Bao gồm

- Monorepo, CI-quality scripts, Dockerfile web/worker và Docker Compose local.
- Better Auth database session, email/username + password, không self-registration.
- RBAC server-side.
- CRUD nền tảng cho branch, staff, account và branch assignment.
- Audit skeleton cho create/update quan trọng.
- Dashboard tối thiểu để chứng minh GM và TM nhận đúng scope.
- Health endpoints, seed tài khoản GM và integration test chặn cross-branch.

### Chưa bao gồm

- Attendance/Live metrics nghiệp vụ đầy đủ.
- Rule engine, KPI scoring, payroll calculation.
- Import/export thật, job export và signed URL.
- Spreadsheet tháng, chart và employee self-service hoàn chỉnh.

Các package cần cho các phần chưa triển khai có thể được ghi trong kiến trúc nhưng không nhất thiết cài ở Phase 1.

## 7. Tiêu chí nghiệm thu Phase 1

- GM đăng nhập và tạo branch, staff, user; phân công TM bằng khoảng hiệu lực.
- TM đăng nhập chỉ truy vấn được branch đang được phân công.
- API từ chối IDOR khi TM dùng ID branch/staff ngoài scope.
- Tài khoản bị vô hiệu hóa hoặc assignment hết hiệu lực không nhận được scope.
- Create/update branch, staff, user và assignment có audit.
- Lint, typecheck, unit/integration tests và production build pass.
- Có hướng dẫn local setup, migrate, seed, deploy, backup, restore và rollback.
