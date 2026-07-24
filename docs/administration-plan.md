# Kế hoạch quản trị dữ liệu nền tảng

## Phạm vi và quyền

`/administration` và các endpoint `/api/administration/*` chỉ dành cho
`GENERAL_MANAGER`. Navigation không phải lớp bảo mật: page guard, API session và service đều
kiểm tra lại role và `companyId`.

| Tài nguyên | Tạo | Sửa                                       | Ngừng hoạt động                                   | Khôi phục                          | Xóa cứng |
| ---------- | --- | ----------------------------------------- | ------------------------------------------------- | ---------------------------------- | -------- |
| Cơ sở      | GM  | Tên, địa chỉ                              | `isActive=false`, chặn khi còn phân công hiệu lực | `isActive=true`                    | Không    |
| Nhân viên  | GM  | Hồ sơ, loại/trạng thái theo ngày hiệu lực | Nghỉ việc hoặc archive khi không còn ràng buộc    | Chuyển trạng thái bằng lịch sử mới | Không    |
| Phân công  | GM  | Ngày kết thúc                             | Kết thúc theo ngày hoặc cancel record tương lai   | Tạo khoảng hiệu lực mới            | Không    |
| Tài khoản  | GM  | Role, liên kết nhân sự                    | `active=false`, thu hồi session                   | `active=true`                      | Không    |

Mọi mutation gửi `version` và `reason`, chạy transaction, ghi audit before/after và trả
`409 CONFLICT` nếu bản ghi đã đổi.

## Admin list projection

Bốn endpoint list riêng giữ nguyên response các endpoint nghiệp vụ hiện có:

- `/api/administration/branches`
- `/api/administration/staff`
- `/api/administration/assignments`
- `/api/administration/users`

Mỗi endpoint dùng Zod cho search/filter/sort, page tối đa 100, luôn scope theo
`session.companyId` và trả `{items, page, pageSize, total}` với
`Cache-Control: private, no-store`. DTO user là allow-list, không select account, password,
session hoặc token.

Các projection dùng relation select/group query theo page, không query từng dòng. Index hiện
có đã phủ company/status/effective interval; search contains là chức năng quản trị quy mô nhỏ
và chưa cần thêm production index. Nếu dữ liệu tăng lớn, cân nhắc PostgreSQL trigram bằng ADR
và query plan thực tế.

## Luồng trạng thái

- Cơ sở: active → inactive chỉ khi không còn phân công hiệu lực; dữ liệu lịch sử giữ nguyên.
- Nhân viên: thay đổi category/status tạo hoặc đóng `StaffEmploymentHistory` tại ngày hiệu
  lực, không sửa lịch sử quá khứ.
- Phân công: current → ended bằng `effectiveTo`; transfer đóng khoảng cũ và tạo khoảng mới
  trong một transaction; future → cancelled bằng `archivedAt`.
- Tài khoản: active → inactive thu hồi mọi session; không cho tự vô hiệu hóa hoặc vô hiệu hóa
  GM active cuối cùng.

## UX và conflict

Tab/search/filter/page nằm trên URL. Form thêm/sửa chỉ mount khi drawer mở. Action nguy hiểm
dùng confirm dialog, mô tả hậu quả và bắt nhập lý do. Khi nhận `409`, form giữ dữ liệu đang
nhập và cho tải bản mới.

## Kiểm thử

- Unit: query schema, page limit, sort allow-list.
- Integration: role/company scope, aggregate list, state transition, effective date,
  optimistic lock, audit và session revocation.
- E2E: CRUD mềm của bốn tab, URL state, conflict, mobile keyboard và direct URL/API denial.
