# Hướng dẫn Quản lý đào tạo

Manager chỉ thấy branch đang được phân công theo effective date. Nếu URL hoặc bộ lọc hiển thị
branch khác, dừng thao tác và báo GM; không chia sẻ link/file để thử vòng quyền.

## Chấm công tháng

1. Chọn tháng và nhân viên trong branch.
2. Nhập check-in/out, actual live, overtime, work units, revenue và note.
3. Theo dõi trạng thái autosave.
4. Nếu có `409 conflict`, tải lại dữ liệu, so sánh và nhập lại thay đổi cần giữ; không ghi đè
   mù.
5. Shift qua ngày chỉ được đánh dấu khi thực tế có qua ngày.

Manager không được sửa attendance của chính mình. GM chấm công/KPI cho manager.

## Vi phạm và evidence

- Chọn category hiệu lực đúng ngày; hệ thống snapshot rule và mức phạt.
- Ghi detail thực tế, không đưa password/token hoặc dữ liệu ngoài mục đích vào note.
- Chỉ tải ảnh đúng MIME/kích thước; đợi trạng thái verified.
- Cancel violation phải có lý do. Manager không được override amount.
- Employee error report tuyệt đối không có revenue; nếu thấy revenue, không gửi và báo GM.

## Import/export

Luôn dry-run, kiểm tra mapping và lỗi row/column trước commit. Không import assignment hoặc
dữ liệu branch ngoài phạm vi. File CSV/XLSX từ nguồn không tin cậy phải được kiểm tra macro/
formula; hệ thống neutralize formula injection nhưng không thay thế quy trình kiểm duyệt file.
