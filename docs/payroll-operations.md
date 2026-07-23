# Vận hành payroll

## Trước khi calculate

- Attendance/live metrics hoàn tất, không còn conflict.
- Violation đã xác minh/cancel đúng trạng thái.
- Salary/reward/level rules active đúng effective interval.
- Level history và branch assignment đúng tháng.
- Các quyết định còn mở trong `docs/open-questions.md` đã có config/default được duyệt.

## Workflow

1. **DRAFT**: tạo period theo branch/month/revision.
2. **CALCULATED**: worker/application tổng hợp input và tạo entry/line/snapshot/hash.
3. **REVIEWED**: GM kiểm totals, anomaly và diff lần tính trước.
4. **LOCKED**: snapshot immutable; export phải khớp database.
5. **PUBLISHED**: employee chỉ xem payslip của mình khi self-service bật.

Recalculate draft phải idempotent. Rule mới không thay snapshot cũ. Sau lock, dùng adjustment
hoặc revision mới có reason/audit; không update trực tiếp line/snapshot.

## Kiểm soát bốn mắt

Trước lock/publish, một người chuẩn bị và một GM khác hoặc người được ủy quyền kiểm:

- headcount/included staff;
- 0.5 work units, overtime và tier boundary;
- penalties/advance/other bonus;
- tổng entry = tổng branch = company report;
- rounding policy và selected rule versions;
- sample payslip PDF/XLSX.

Nếu tổ chức chưa có người thứ hai, ghi exception và người phê duyệt trong nhật ký vận hành.

## Export và sự cố

Payroll file là dữ liệu nhạy cảm, bucket private, signed URL ngắn hạn và download được audit.
Bulk ZIP chỉ do worker xử lý. Job retry exponential backoff tối đa ba lần rồi vào
`export-dead-letter`; không retry liên tục khi chưa xử lý nguyên nhân.

Khi total sai: dừng publish, lưu calculation diff/requestId, sửa nguồn hoặc rule draft rồi
recalculate. Khi đã publish: tạo revision/adjustment theo chính sách, không sửa lịch sử.
