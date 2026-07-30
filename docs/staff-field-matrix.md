# Ma trận dữ liệu hồ sơ nhân viên

Tài liệu này là nguồn tham chiếu cho các màn hình `/staff`,
`/administration?tab=staff`, Attendance và Payroll. DTO phía server vẫn phải
lọc dữ liệu theo quyền; không được dựa vào việc ẩn trường ở giao diện.

## Hồ sơ thuộc `StaffMember`

| Trường | Kiểu lưu trữ | Training Manager | General Manager | Ghi chú |
| --- | --- | --- | --- | --- |
| `staffCode` | string | xem/sửa trong phạm vi cơ sở | xem/sửa | Duy nhất trong công ty |
| `fullName` | string | xem/sửa | xem/sửa | Bắt buộc |
| `streamingAlias` | string/null | xem/sửa | xem/sửa | Tên kênh/ACC |
| `tiktokChannelId` | string/null | xem/sửa | xem/sửa | Không lưu ký tự `@` đầu |
| `dateOfBirth` | date/null | xem/sửa | xem/sửa | Ngày nghiệp vụ |
| `citizenIdNumber` | string/null | xem/sửa | xem/sửa | Dữ liệu nhạy cảm, audit phải redaction |
| `email` | string/null | xem/sửa | xem/sửa | Email hồ sơ, không đồng nghĩa tài khoản |
| `phone` | string/null | xem/sửa | xem/sửa |  |
| `bankAccountNumber` | string/null | xem/sửa | xem/sửa | Dữ liệu nhạy cảm, audit phải redaction |
| `bankName` | string/null | xem/sửa | xem/sửa |  |
| `permanentAddress` | string/null | xem/sửa | xem/sửa |  |
| `temporaryAddress` | string/null | xem/sửa | xem/sửa |  |
| `facebookUrl` | URL/null | xem/sửa | xem/sửa | Chỉ HTTP/HTTPS |
| `university` | string/null | xem/sửa | xem/sửa |  |
| `jobTitle` | string | xem/sửa | xem/sửa |  |
| `joinedDate` | date/null | xem/sửa | xem/sửa | Hồ sơ legacy có thể null; hồ sơ mới bắt buộc |
| `officialDate` | date/null | xem/sửa | xem/sửa | Không trước ngày gia nhập |
| `terminationDate` | date/null | không sửa | xem/sửa | Soft termination |
| `employmentCategory` | enum | xem/sửa | xem/sửa | Có lịch sử hiệu lực |
| `employmentStatus` | enum | xem | xem/sửa | Có lịch sử hiệu lực |
| `baseSalaryAmount` | bigint VND | không trả trong DTO | xem/sửa | Chỉ GM/Payroll được cấp quyền |

## Dữ liệu theo phân công `BranchAssignment`

| Trường | Kiểu lưu trữ | Quy tắc |
| --- | --- | --- |
| `assignmentId` | UUID | Định danh bắt buộc khi sửa, không suy đoán bằng `findFirst` |
| `branchId` | UUID | Lấy từ assignment đã authorize phía server |
| `assignmentType` | enum | Mã máy chỉ áp dụng cho `MEMBER` |
| `attendanceMachineCode` | string/null | Giữ số 0 đầu; duy nhất theo cơ sở và khoảng hiệu lực |
| `effectiveFrom` | date inclusive | Ngày nghiệp vụ Asia/Ho_Chi_Minh |
| `effectiveTo` | date exclusive/null | Không overlap cùng loại phân công |
| `version` | integer | Optimistic lock |

## Ca làm `StaffWorkSchedule`

`name`, `scheduledStartMinutes`, `scheduledEndMinutes`, `spansNextDay`,
`requiredLiveMinutes`, `effectiveFrom`, `effectiveTo` và `version` được quản lý
theo khoảng hiệu lực. Thời lượng lưu bằng phút nguyên.

## Tài liệu riêng tư

CCCD mặt trước, CCCD mặt sau và QR ngân hàng nằm trong private object storage.
DTO danh sách chỉ trả metadata và trạng thái. Signed GET/PUT chỉ được phát sau
khi server kiểm tra quyền theo công ty/cơ sở/người dùng; phiên bản cũ được
`SUPERSEDED`, không hard-delete.

## Payroll

Payroll snapshot phải giữ danh tính tại thời điểm tính gồm `staffCode`,
`fullName`, `branchId` và các khoảng mã máy chấm công áp dụng trong kỳ. Bản
in/export của kỳ đã khóa hoặc publish dùng snapshot, không đọc mã hiện tại.
