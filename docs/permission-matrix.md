# Ma trận quyền

## 1. Nguyên tắc

Quyền hiệu lực là giao của:

1. role trong session;
2. `companyId` của session;
3. branch assignment đang hiệu lực tại ngày truy cập;
4. quan hệ sở hữu đối với employee self-service;
5. trạng thái publish và company setting;
6. trạng thái bản ghi (ví dụ payroll đã khóa).

Client không được quyết định scope. `branchId`, `companyId`, `staffId` từ request chỉ là đối tượng cần kiểm tra, không phải bằng chứng quyền.

## 2. Ma trận chức năng đích

| Tài nguyên / hành động    | GENERAL_MANAGER                           | TRAINING_MANAGER                                           | LIVE_EMPLOYEE                              |
| ------------------------- | ----------------------------------------- | ---------------------------------------------------------- | ------------------------------------------ |
| Company settings          | Đọc/sửa, có audit + lý do                 | Không                                                      | Không                                      |
| Branch                    | CRUD/archive toàn công ty, có audit       | Đọc branch được phân công                                  | Không                                      |
| Staff                     | CRUD toàn công ty                         | Đọc staff trong branch; cập nhật trường nghiệp vụ được cấp | Chỉ đọc hồ sơ bản thân được phép           |
| User/account              | CRUD/disable/reset toàn công ty, có audit | Không                                                      | Đổi thông tin cá nhân/mật khẩu theo policy |
| Branch assignment         | CRUD toàn công ty, có audit               | Đọc assignment của mình và staff trong scope               | Không                                      |
| Level history             | CRUD toàn công ty                         | Đọc trong scope                                            | Đọc level bản thân đã publish              |
| Attendance nhân viên Live | CRUD trong công ty                        | CRUD trong branch scope                                    | Đọc bản thân đã publish                    |
| Violation/evidence        | CRUD/archive trong công ty                | CRUD trong branch scope                                    | Đọc bản thân đã publish                    |
| Attendance TM             | CRUD                                      | Không                                                      | Không                                      |
| KPI TM                    | CRUD/publish                              | Chỉ đọc KPI bản thân đã publish                            | Không                                      |
| Active rules              | CRUD/version/publish                      | Chỉ đọc rule hiệu lực                                      | Chỉ đọc rule hiệu lực                      |
| Payroll                   | Calculate/review/lock/publish/export      | Không                                                      | Chỉ payslip bản thân đã publish            |
| Báo cáo công ty           | Đọc/export                                | Không                                                      | Không                                      |
| Báo cáo branch            | Đọc/export                                | Đọc/export branch scope                                    | Không                                      |
| Audit                     | Đọc toàn công ty                          | Không mặc định                                             | Không                                      |
| Import/export center      | Toàn công ty                              | Chỉ loại job được cấp và branch scope                      | Không                                      |

`CRUD` không đồng nghĩa hard-delete. Dữ liệu lịch sử/tài chính chỉ được archive, đóng khoảng hiệu lực hoặc tạo revision.

Company dashboard/report và export XLSX/PDF luôn kiểm tra GM ở server; không có
branch query parameter nào mở rộng quyền. KPI manager chỉ trả bản thân +
`PUBLISHED` khi `managerKpiSelfServiceEnabled` đang bật; draft không bao giờ được
trả cho manager.

## 3. Ma trận endpoint Phase 1

| Endpoint                     | GM             | TM                                 | Employee                 | Quy tắc server                                    |
| ---------------------------- | -------------- | ---------------------------------- | ------------------------ | ------------------------------------------------- |
| `GET /api/me`                | Có             | Có                                 | Có                       | Session hợp lệ, DTO tối thiểu                     |
| `GET /api/branches`          | Tất cả company | Branch đang phân công              | Không                    | Scope lấy từ session/DB                           |
| `POST /api/branches`         | Có             | Không                              | Không                    | Audit + reason                                    |
| `PATCH /api/branches/:id`    | Có             | Không                              | Không                    | Company match, optimistic version, audit + reason |
| `GET /api/staff`             | Tất cả company | Staff có assignment giao với scope | Bản thân (giai đoạn sau) | Không tin branch scope từ client                  |
| `POST /api/staff`            | Có             | Không                              | Không                    | Transaction + audit                               |
| `PATCH /api/staff/:id`       | Có             | Không                              | Không                    | Company match, audit + reason                     |
| `POST /api/users`            | Có             | Không                              | Không                    | Không self-registration; staff cùng company       |
| `PATCH /api/users/:id`       | Có             | Không                              | Không                    | Không cho tự nâng quyền; audit + reason           |
| `POST /api/assignments`      | Có             | Không                              | Không                    | Không overlap; branch/staff cùng company; audit   |
| `PATCH /api/assignments/:id` | Có             | Không                              | Không                    | Đóng/sửa khoảng hợp lệ; audit                     |

## 4. Quy tắc query scope

- `GENERAL_MANAGER`: mọi query phải có `companyId = session.user.companyId`.
- `TRAINING_MANAGER`: query phải có `companyId` và `branchId ∈ activeBranchIds(session.user.staffId, now)`.
- Staff thuộc scope TM khi có assignment giao với branch scope tại ngày truy vấn. Không dựa vào “branch hiện tại” do client gửi.
- `LIVE_EMPLOYEE`: `staffId = session.user.staffId`, record published, self-service bật và field-level setting cho phép.
- Dữ liệu tiền lương/doanh số bị loại khỏi DTO ngay tại server nếu role/setting không cho phép.

### Endpoint attendance (Prompt 1)

| Endpoint                                 | GM                          | TM                                                 | Employee                                |
| ---------------------------------------- | --------------------------- | -------------------------------------------------- | --------------------------------------- | ----- |
| `GET /api/attendance?staffId&month`      | Staff toàn company          | Chỉ Live staff trong branch hiện tại               | Chưa bật                                |
| `POST /api/attendance`                   | Live staff và manager       | Chỉ Live staff trong branch, không phải chính mình | Không                                   |
| `PATCH                                   | DELETE /api/attendance/:id` | Toàn company                                       | Cùng scope như create; version bắt buộc | Không |
| `GET /api/exports/employee-error-report` | Staff toàn company          | Chỉ Live staff trong branch                        | Không                                   |

`branchId` không xuất hiện trong mutation input. Server resolve assignment tại business date rồi snapshot branch. Export error report dùng allow-list attendance và không select live metric/revenue.

### Endpoint rule, violation và evidence (Prompt 2)

| Endpoint/action                      | GM                           | TM                                        | Employee                    |
| ------------------------------------ | ---------------------------- | ----------------------------------------- | --------------------------- |
| Đọc `/api/rules/penalty/active?date` | Rule hiệu lực trong company  | Rule hiệu lực trong company               | Rule hiệu lực trong company |
| Tạo/sửa/clone/publish/retire rule    | Có, reason + audit + version | Không                                     | Không                       |
| Tạo/cancel violation                 | Attendance toàn company      | Live staff trong branch, không chính mình | Không                       |
| Presign/complete/view evidence       | Violation toàn company       | Violation trong branch scope              | Chưa bật                    |
| Compare/lịch sử rule                 | Có                           | Không                                     | Không                       |

Server tự lấy company/branch scope từ actor context. Penalty item phải thuộc version hiệu lực tại business date. Chỉ GM được override amount và bắt buộc có `overrideReason`; violation luôn snapshot amount/rule/item. Signed GET chỉ được tạo sau khi authorize evidence qua attendance/branch.

### Endpoint branch overview (Prompt 3)

| Endpoint/action                                   | GM                              | TM                                                | Employee |
| ------------------------------------------------- | ------------------------------- | ------------------------------------------------- | -------- |
| `GET /api/branch-overview?branchId&month&filters` | Chọn mọi branch trong company   | Chỉ branch nằm trong `activeBranchIds`            | Không    |
| `PATCH /api/branch-overview`                      | Edit Live staff toàn company    | Edit Live staff trong branch, không phải bản thân | Không    |
| `GET /api/exports/branch-monthly-overview`        | Export mọi branch trong company | Export branch trong scope                         | Không    |

`branchId` trong query/body chỉ là target cần authorize. Server giao company/branch/staff scope vào projection và attendance source service; workbook chỉ nhận DTO đã scope. Cell edit dùng version của attendance nguồn, không cập nhật một bảng tổng riêng.

## 5. Test bắt buộc

- TM branch A gọi branch B bằng ID đoán được → `404` hoặc `403` thống nhất, không rò metadata.
- TM branch A liệt kê staff → không có staff chỉ thuộc branch B.
- TM có assignment hết hạn → không còn scope.
- User company A dùng ID company B → bị chặn.
- Employee dùng staff ID người khác → bị chặn.
- API export báo lỗi → response không có key/cột doanh số.
- GM mutation nhạy cảm thiếu `reason` → validation error.

### Import, Export Center và Audit (Prompt 7)

| Endpoint/action                  | GM                         | Training Manager                                                       | Employee |
| -------------------------------- | -------------------------- | ---------------------------------------------------------------------- | -------- |
| Upload/map/preview/commit import | Mọi template trong company | Chỉ staff, assignment, attendance/live; bắt buộc branch đang phân công | Không    |
| Xem/tải file lỗi import          | Mọi job company            | Job thuộc branch scope hoặc job chính mình tạo                         | Không    |
| Tạo Export Center job            | Mọi template               | Employee error và branch monthly trong branch scope                    | Không    |
| Download private export          | Job trong company          | Job thuộc branch scope                                                 | Không    |
| Đọc/export audit                 | Có                         | Không                                                                  | Không    |

Server resolve branch code trong từng dòng import rồi so với `activeBranchIds`; không tin
`branchId` hoặc column mapping do client gửi. Employee error export không query live
metric/revenue. Payslip, company report và audit export bị chặn cho manager kể cả đoán ID.
Với staff/assignment/attendance import, server còn kiểm tra staff là Live, không phải chính
manager và có assignment `MEMBER` hiệu lực tại branch/ngày của từng dòng ở cả preview lẫn commit.
