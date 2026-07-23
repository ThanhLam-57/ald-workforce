# Câu hỏi mở và default đề xuất

Không mục nào dưới đây được hardcode vào domain/UI trước khi được xác nhận. Default chỉ là phương án giúp thiết kế contract và test.

| Chủ đề               | Câu hỏi cần xác nhận                                      | Default đề xuất để thảo luận                                                          |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Đơn vị doanh số      | Doanh số là VND, xu/điểm hay số sản phẩm? Có hoàn/hủy?    | Số nguyên VND; hoàn/hủy là adjustment có source, không sửa ngược record đã khóa       |
| Attribution doanh số | Gắn theo ngày Live, ca, đơn hàng hay ngày ghi nhận tiền?  | Gắn source transaction vào ngày nghiệp vụ được chốt                                   |
| Ca qua nửa đêm       | Work date theo giờ bắt đầu hay giờ kết thúc?              | Theo ngày bắt đầu ca trong `Asia/Ho_Chi_Minh`                                         |
| Tăng ca              | Tính theo phút, block hay hệ số ngày thường/cuối tuần/lễ? | Lưu phút; rule config quyết định rate/block                                           |
| Đi muộn/về sớm       | Có grace period, làm tròn hoặc trừ công/phạt kép không?   | Lưu phút thực; policy quyết định grace và hậu quả, tránh phạt kép mặc định            |
| Số công chuẩn        | Theo lịch công ty, branch hay từng nhân viên?             | Calendar versioned theo company/branch                                                |
| Tier thưởng          | Biên inclusive/exclusive, fixed/rate, toàn phần/marginal? | `[lower, upper)`, ordered, tier cuối `upper = null`; loại tính phải khai báo          |
| Giới hạn thưởng      | Có cap ngày/tháng hoặc minimum Live time?                 | Các cap/eligibility là field tùy chọn của rule                                        |
| Rounding             | Làm tròn đơn vị nào, mode nào, tại bước nào?              | 1 VND, half-up từng breakdown line; cần xác nhận                                      |
| Level effective date | Level mới áp dụng đầu ngày, đầu tháng hay prorate?        | `[effectiveFrom, effectiveTo)` theo ngày; bonus từng ngày chọn level tại work date    |
| Employment change    | Nghỉ việc/chuyển branch giữa tháng xử lý lương ra sao?    | Dựa interval từng ngày, không ghi đè lịch sử                                          |
| Doanh số employee    | Nhân viên có xem doanh số bản thân không?                 | Company setting mặc định tắt; có thể bật toàn công ty                                 |
| Self-service         | Tắt toàn bộ hay theo account/branch?                      | Company setting + trạng thái account, deny by default                                 |
| Publish attendance   | Ai publish và có cần employee acknowledge?                | TM draft, GM hoặc quyền riêng publish; employee chỉ đọc published                     |
| Sửa tháng khóa       | Cho sửa nguồn attendance/rule sau khi payroll locked?     | Không đổi snapshot; tạo correction + payroll revision/adjustment                      |
| Payroll âm           | Cho total income âm hay floor 0 và carry debt?            | Hiển thị gross/net/debt riêng; chưa floor cho tới khi có policy                       |
| Advance              | Nguồn advance và approval workflow?                       | Manual adjustment có approver/source document                                         |
| Nhiều manager/branch | Một staff có đồng thời nhiều branch không?                | Có secondary assignment; primary không overlap                                        |
| Manager chính        | Mỗi branch có đúng một TM chính theo thời gian?           | Có assignment type `PRIMARY_MANAGER`; DB constraint sau khi chốt                      |
| Staff code           | Unique toàn company hay branch? Có tái sử dụng?           | Unique toàn company, không tái sử dụng                                                |
| Username             | Có phân biệt hoa thường/Unicode không?                    | Normalize lowercase ASCII-like; unique toàn hệ thống cho login                        |
| GM reason            | Mutation nào bắt buộc nhập lý do?                         | Update/archive account, staff, assignment, settings và mọi financial/history mutation |
| Audit retention      | Giữ audit/evidence/payroll bao lâu?                       | Không purge cho tới khi có policy pháp lý; backup mã hóa                              |
| Import idempotency   | Khóa theo file hash hay external row ID?                  | Company + import type + file hash; row dùng stable source key nếu có                  |
| Evidence             | Loại file, dung lượng, retention, antivirus?              | Allow-list MIME, size limit cấu hình, quarantine/scan trước publish                   |
| Export PDF           | Layout/chữ ký/watermark cụ thể?                           | Server-rendered PDF, version template và audit mỗi job                                |
| Tuần doanh số        | Tuần 1..n là ngày 1–7 hay ISO week?                       | Đã chọn thứ Hai–Chủ nhật, cắt tại biên tháng; cần business xác nhận                   |
| Ngày lễ              | Nguồn và quyền sửa calendar?                              | Calendar company versioned, GM quản trị                                               |
| Xóa dữ liệu          | Có yêu cầu pháp lý right-to-erasure?                      | Pseudonymize PII theo quy trình đặc biệt, giữ ledger/audit tối thiểu                  |

## Default tạm thời đã áp dụng trong Prompt 5

Các mục sau vẫn là TODO nghiệp vụ nhưng đã được biểu diễn bằng config/snapshot để
không tạo hardcode ngầm:

- Salary rule phải bao phủ trọn kỳ; thay đổi giữa tháng hiện bị chặn.
- Tăng ca tính theo phút và `multiplierBps` của salary rule.
- Daily reward là fixed whole-tier theo business date; monthly level rule và level
  history được chọn tại ngày cuối tháng.
- Payroll âm được giữ nguyên và gắn anomaly; chưa tạo debt carry-forward.
- Không tính thuế/bảo hiểm cho tới khi có rule typed được duyệt.
- Adjustment sau khóa luôn tạo revision mới; kỳ đã khóa không mutate.
- PDF dùng `PAYSLIP_V1`, Noto Sans, chưa có watermark/chữ ký. Ảnh tham chiếu hiện
  chưa có trong `docs/references/`.

## Default tạm thời đã áp dụng trong Prompt 6

- Tuần báo cáo là thứ Hai–Chủ nhật và cắt tại biên tháng; tháng có thể có 4–6 tuần.
- Status/category lịch sử mặc định bắt đầu từ ngày tạo staff; migration hiện tại
  backfill record cũ từ `createdAt` theo timezone `Asia/Ho_Chi_Minh`.
- KPI template được chọn tại ngày cuối tháng và phải có đúng một version hiệu lực.
  Nếu có nhiều version/template cùng hiệu lực, hệ thống chặn tạo evaluation.
- Evidence KPI hiện là ghi chú hoặc mã/link tài liệu nội bộ đã được bảo vệ; chưa
  tự cấp signed URL riêng cho KPI.
- Manager KPI self-service mặc định tắt; GM bật ở company setting và manager chỉ
  xem bản publish của chính mình.

## Quyết định cần có trước Phase 2

1. Quy tắc assignment primary/secondary và chuyển branch trong ngày.
2. Attendance publish workflow, conflict behavior và cutoff.
3. Đơn vị revenue, attribution và correction.
4. Danh mục employment category/performance level ban đầu.

## Quyết định cần có trước Rule/Payroll

1. Số công chuẩn, tăng ca và đi muộn.
2. Cấu trúc tier và rounding.
3. Level effective behavior.
4. Chính sách tháng locked/revision.
5. Quyền employee xem revenue và payslip.
6. Payroll âm, advance, tax/insurance nếu có.

## Default tạm thời đã áp dụng trong Prompt 7

- Import nhận XLSX/CSV tối đa 20 MiB, 20 sheet, 100 cột và 50.000 dòng; batch commit
  là 200 dòng. Cần đo dữ liệu thật trước khi tăng.
- File trùng được nhận diện theo company + template + SHA-256; idempotency key cùng
  checksum trả lại job cũ.
- Antivirus/quarantine object chưa được tích hợp; MIME, size, checksum, giới hạn cấu
  trúc và formula rejection là gate hiện tại. TODO: chọn malware scanner trước production.
- Export giữ 7 ngày, cấu hình 1–30 ngày bằng `EXPORT_RETENTION_DAYS`; metadata job và
  audit giữ lâu dài.
- Audit append-only, chưa triển khai cryptographic hash chain/WORM storage.
- Historical payroll import tạo snapshot `legacy-import-v1`, không tái tính rule quá khứ.
