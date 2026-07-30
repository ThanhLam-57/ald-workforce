# Architecture Decision Records

## ADR-013 — Typed JSON cho các rule cấu hình

- Trạng thái: Accepted.
- Quyết định: `DAILY_REWARD_TIERS`, `MONTHLY_LEVEL_RULES`, `SALARY_RULES` và
  `KPI_TEMPLATE` dùng chung `RuleSet`/`RuleVersion`; nội dung nghiệp vụ được lưu
  trong `RuleVersion.configuration` dạng JSONB và bắt buộc parse qua Zod schema
  phân biệt bằng `kind`.
- Mỗi schema chỉ chứa dữ liệu có kiểu: số tiền nguyên dạng string, số phút nguyên,
  basis points, enum policy và danh sách tiêu chí/bậc. Không có expression,
  JavaScript hoặc tên hàm có thể thực thi.
- Draft được phép sửa bằng optimistic lock. PostgreSQL trigger hiện có bảo vệ toàn
  bộ hàng `RuleVersion`, gồm cả `configuration`, sau khi publish. Exclusion
  constraint tiếp tục bảo vệ khoảng hiệu lực `[effectiveFrom, effectiveTo)`.
- Lý do: bốn nhóm rule có cùng lifecycle/audit/effective-date nhưng cấu trúc khác
  nhau. JSONB có validation nghiêm giữ một engine versioning duy nhất mà không tạo
  bốn bộ bảng lifecycle trùng lặp.

## ADR-014 — Đề xuất level là bản ghi quyết định, không ghi thẳng lịch sử

- Trạng thái: Accepted.
- Quyết định: kết quả đề xuất level lưu `sourceMonth`, doanh số snapshot,
  `ruleVersionId`, level đề xuất và `effectiveFrom` là ngày đầu tháng kế tiếp.
  GM xác nhận hoặc override bằng optimistic lock và lý do bắt buộc; sau đó
  application service mới đóng/mở khoảng `LevelHistory` trong cùng transaction.
- `LevelProposal` và `LevelHistory` không hard-delete; database bảo vệ interval
  level không overlap.
- Lý do: giữ được dấu vết giữa kết quả máy đề xuất và quyết định cuối của GM,
  đồng thời không làm thay đổi level của tháng dữ liệu nguồn.

## ADR-001 — Modular monolith trong pnpm/Turborepo

- Trạng thái: Accepted
- Quyết định: Next.js web và Node worker dùng chung domain/contracts/db packages; không tách microservice module.
- Lý do: transaction/audit và tenant boundary rõ, vận hành v1 đơn giản, vẫn tách được workload dài qua pg-boss.

## ADR-002 — PostgreSQL là source of truth và job backend

- Trạng thái: Accepted
- Quyết định: Prisma/PostgreSQL cho dữ liệu; pg-boss trên cùng PostgreSQL; không Redis v1.
- Lý do: giảm hạ tầng, hỗ trợ transaction và idempotent job phù hợp quy mô ban đầu.

## ADR-003 — Better Auth database sessions

- Trạng thái: Accepted
- Quyết định: Better Auth + Prisma adapter, email/username/password, database session, không self-registration.
- Lý do: session có thể thu hồi, account được GM provision và scope vẫn được resolve lại phía server.

## ADR-004 — Private S3-compatible object storage

- Trạng thái: Accepted
- Quyết định: AWS SDK contract, MinIO local, private bucket và signed URL sau authorize.
- Lý do: không đưa evidence/file lớn vào database và tránh public object URL.

## ADR-005 — Tiền BIGINT và công thức domain thuần

- Trạng thái: Accepted
- Quyết định: tiền/revenue là BIGINT, phút là integer, work units là Decimal; pure/config-driven functions.
- Lý do: tránh sai số floating point và cho phép deterministic snapshot/golden tests.

## ADR-006 — Dependency Phase 1

- Trạng thái: Accepted
- Production: Next.js/React, Better Auth, Prisma client/adapter, Zod, pg-boss.
- Development: TypeScript, ESLint, Vitest, Playwright, Turbo, Prisma CLI.
- Lý do: đây là tập tối thiểu để hoàn thành foundation. Tailwind được dùng ở web scaffold. TanStack Table/Virtual, Recharts, AWS SDK, ExcelJS và PDF engine chỉ cài ở phase cần dùng để tránh dependency chưa có implementation.

## ADR-007 — Prisma 7 explicit generated client

- Trạng thái: Accepted
- Quyết định: dùng generator `prisma-client` với output tường minh và PostgreSQL driver adapter.
- Lý do: phù hợp Prisma 7, tránh phụ thuộc generated code ẩn trong `node_modules` và giúp web/worker import cùng một client package.

## ADR-008 — Attendance duy nhất, branch snapshot và archive

- Trạng thái: Accepted
- Quyết định: attendance unique theo `(companyId, staffId, businessDate)` kể cả khi archive; branch được resolve từ assignment hiệu lực và snapshot vào record, không nhận từ client.
- Quyết định: live metric là extension 1–1, snapshot `revenueUnit/revenueScale`; amount dùng BIGINT và API dùng string.
- Quyết định: `DELETE /api/attendance/:id` chỉ đặt `archivedAt`, tăng version và audit before/after.
- Lý do: ngăn nhập trùng, giữ lịch sử chuyển cơ sở, tránh diễn giải lại doanh số khi config đổi và tuân thủ no-hard-delete.

## ADR-009 — Lưu thủ công và optimistic concurrency

- Trạng thái: Accepted
- Quyết định: màn `/attendance` giữ thay đổi ở client và chỉ gửi mutation khi người dùng bấm
  `Lưu thay đổi`. Update/archive phải gửi version; update dùng compare-and-increment trong
  transaction. Conflict trả HTTP 409 kèm DTO `current` đã authorize để UI tải lại hoặc ghép
  thay đổi.
- Lý do: lưu thủ công giúp người nhập kiểm tra nhiều dòng trước khi ghi; optimistic concurrency
  vẫn ngăn last-write-wins làm mất dữ liệu khi có nhiều người cùng thao tác.

## ADR-010 — Evidence private S3 và presigned URL ngắn hạn

- Trạng thái: Accepted
- Production dependency mới: `@aws-sdk/client-s3` và `@aws-sdk/s3-request-presigner`.
- Quyết định: database chỉ lưu private object key và metadata; browser upload bằng presigned PUT 5 phút, view bằng presigned GET 60 giây sau khi server authorize lại.
- Quyết định: allow-list JPEG/PNG/WebP, giới hạn 10 MiB, ký Content-Type + SHA-256 checksum + checksum metadata và HEAD verify size/type/checksum trước trạng thái READY.
- Lý do: SDK chính thức hỗ trợ S3/MinIO path-style, không đưa file qua Next.js process, không tạo public URL và cho phép kiểm tra toàn vẹn trước khi evidence được sử dụng.

## ADR-011 — Penalty version bất biến và violation snapshot

- Trạng thái: Accepted
- Quyết định: draft chỉnh sửa được; SCHEDULED/ACTIVE/RETIRED không sửa nội dung. PostgreSQL trigger bảo vệ cả rule version và penalty items đã publish.
- Quyết định: effective interval dùng `[effectiveFrom, effectiveTo)` và exclusion constraint chặn overlap theo rule set.
- Quyết định: violation snapshot item name, amount và rule/item IDs; publish version mới không hồi tố record cũ.
- Lý do: rule phải tái hiện đúng tại ngày vi phạm và payroll/report tương lai không được đổi theo cấu hình mới.

## ADR-012 — Branch monthly overview là projection, không phải aggregate nhập liệu

- Trạng thái: Accepted
- Production dependency mới: `@tanstack/react-virtual` 3.14.6, Recharts 3.9.2, ExcelJS 4.4.0 và peer `react-is` 19.2.8.
- Quyết định: overview tháng được dựng trực tiếp từ staff/assignment, level history và một query attendance có include live metric/active violations; không tạo bảng monthly aggregate.
- Quyết định: inline edit gọi lại attendance application service, dùng source record version và audit transaction hiện có. Batch paste gom tối đa một edit cho mỗi staff/date và trả kết quả từng cell.
- Quyết định: level tại overview là level hiệu lực vào ngày cuối tháng theo khoảng `[effectiveFrom, effectiveTo)`; lịch sử level không hard-delete.
- Quyết định: web grid ảo hóa cột ngày bằng TanStack Virtual; chart dùng Recharts; export XLSX server-side dùng ExcelJS với dữ liệu đã được authorize/scope trước khi tạo workbook.
- Supply-chain: workspace override `uuid` 11.1.1, `postcss` 8.5.17 và `sharp` 0.35.0 để loại advisory đã biết trong cây ExcelJS/Next; build/export tests là compatibility gate cho override transitive.
- Lý do: giữ một source of truth, tránh lệch tổng giữa overview và employee detail, giới hạn DOM cho bảng 28–31 ngày, và tạo workbook typed/frozen có định dạng tiếng Việt.

## ADR-015 — Payroll ledger, immutable revision và snapshot hash

- Trạng thái: Accepted.
- Quyết định: payroll dùng `PayrollPeriod` revisioned, entry/line chuẩn hóa và
  `CalculationSnapshot` append-only. Canonical SHA-256 input hash là idempotency
  key của recalculation; cùng input/config không sinh calculation mới.
- `LOCKED` và `PUBLISHED` bất biến ở database. Publish chỉ là transition
  `LOCKED -> PUBLISHED`; correction/adjustment sau khóa tạo DRAFT revision mới
  với `sourcePeriodId`, reason và diff audit.
- Rule version IDs, input/output, rounding và engine version nằm trong snapshot.
  Rule publish sau đó không thể diễn giải lại payroll cũ.
- Lý do: payroll là financial ledger; revision rõ ràng an toàn hơn cho phép update
  có điều kiện trên record đã khóa.

## ADR-016 — Payroll export chạy qua worker và private object storage

- Trạng thái: Accepted.
- Production dependency mới ở web: `pg-boss` 12.26.2 để enqueue vào cùng
  PostgreSQL job queue mà worker đang sử dụng.
- Production dependency mới ở worker: PDFKit 0.19.1, Archiver 8.0.0, ExcelJS
  4.4.0, `@expo-google-fonts/noto-sans` 0.4.2 và AWS SDK S3 hiện có.
- Quyết định: web chỉ tạo job đã authorize; worker dựng XLSX/PDF/ZIP, upload private
  storage rồi cập nhật progress. API chỉ cấp signed GET ngắn hạn sau khi authorize
  lại và ghi `PayrollDownloadLog`.
- XLSX dùng ô số khi nằm trong safe integer và chuỗi nếu vượt giới hạn; PDF dùng
  Noto Sans Vietnamese. Mọi file mang template version và snapshot/calculation ID.
- Lý do: tách workload dài khỏi request, tránh public URL, giữ lịch sử tải và bảo
  đảm export luôn gắn với snapshot đã tính.

## ADR-017 — Company intelligence là projection và KPI quản lý là snapshot theo template

- Trạng thái: Accepted.
- Quyết định: báo cáo công ty và dashboard GM được dựng từ assignment/employment
  history, attendance/live metric, active violation và payroll revision phù hợp;
  không tạo bảng tổng hợp nhập liệu. Tổng company luôn được cộng lại từ branch và
  có reconciliation test.
- Tuần báo cáo là thứ Hai–Chủ nhật, cắt tại biên tháng. Vì vậy tháng có thể có
  4–6 bucket tuần; nhãn luôn kèm khoảng ngày thực tế để không nhập nhằng.
- `StaffEmploymentHistory` lưu status/category theo khoảng
  `[effectiveFrom, effectiveTo)` để báo cáo lịch sử vẫn giữ người đã nghỉ.
  `ManagerKpiEvaluation` snapshot tiêu chí từ đúng `KPI_TEMPLATE` hiệu lực tại
  tháng đánh giá. Bản publish và các dòng điểm bị database trigger khóa.
- KPI tự xem là deny-by-default qua setting công ty; manager chỉ nhận DTO của
  chính mình khi evaluation đã publish. Mọi endpoint báo cáo công ty và export
  chỉ dành cho GM.
- Production dependency mới ở web: PDFKit 0.19.1. Hai font Noto Sans cần cho PDF
  tiếng Việt được vendored trong `apps/web/assets/fonts` cùng giấy phép OFL để
  standalone build không phụ thuộc đường dẫn `node_modules`. XLSX tiếp tục dùng
  ExcelJS hiện có; export chạy từ projection đã authorize và được ghi audit.
- Lý do: một source of truth giữ report khớp employee/branch/payroll, còn snapshot
  template bảo đảm KPI lịch sử không đổi khi publish template mới.

## ADR-018 — Import staging ledger, Export Center dùng worker và audit append-only

- Trạng thái: Accepted.
- Import dùng `ImportJob` làm staging ledger: private object key, MIME/size/SHA-256,
  template, mapping, preview, lỗi theo sheet/dòng/cột và trạng thái commit. Unique
  `(companyId, idempotencyKey)` và `(companyId, template, checksumSha256)` ngăn chạy lại
  tạo duplicate.
- File import tối đa 20 MiB, 20 sheet, 100 cột và 50.000 dòng. XLSX formula và chuỗi
  có tiền tố công thức trong CSV bị từ chối trước commit. Commit chia batch 200 dòng;
  mỗi batch là một transaction và có audit riêng.
- `DataExportJob` là hàng đợi chung cho employee error report, branch monthly, payslip,
  company monthly và audit. Worker tạo XLSX/CSV, neutralize formula injection, upload
  private S3 và chỉ trả signed GET 60 giây sau khi authorize lại.
- Export mặc định giữ 7 ngày (`EXPORT_RETENTION_DAYS`, giới hạn 1–30 ngày). Worker
  chạy cleanup lúc 03:00 `Asia/Ho_Chi_Minh`, xóa object rồi chuyển job sang `EXPIRED`;
  metadata/audit vẫn được giữ.
- `AuditLog` có `branchId` nullable để lọc nhanh; database trigger chặn UPDATE/DELETE.
  Redaction đệ quy che password/token/session/credential trước khi ghi mới và trước
  khi đọc/export dữ liệu lịch sử.
- Không thêm production dependency: parser/generator dùng ExcelJS, AWS SDK và pg-boss
  đã có từ các phase trước.

## ADR-019 — Payroll worksheet chỉnh sửa được nhưng không sửa dữ liệu nguồn

- Trạng thái: Accepted.
- `/payroll` dùng một kỳ làm việc mới nhất theo `(company, branch, month)` và tự tạo
  idempotent khi chưa có. Revision vẫn tồn tại trong ledger để bảo toàn lịch sử,
  nhưng không còn là thao tác người dùng. Khi sửa kỳ đã gửi, backend tự tạo working
  revision, copy snapshot/override liên quan và giữ nguyên kỳ đã publish.
- Giá trị sửa tay lưu trong `PayrollWorksheetOverride` theo `(period, staff)`, có
  optimistic version. Attendance, LiveDailyMetric và Violation không bị cập nhật
  ngược. Snapshot luôn giữ cả dữ liệu nguồn, giá trị tính và giá trị cuối cùng.
- `standardDaysOffPerMonth` nằm trong salary rule. Mỗi branch/month có thể đặt
  `standardDaysOffOverride`; số ngày công chuẩn là số ngày dương lịch thực tế của
  tháng trừ số ngày nghỉ. Lương cơ bản vẫn lấy từ hồ sơ từng nhân viên.
- Chỉ `GENERAL_MANAGER` được xem, sửa và export payroll. Trường
  `canManagePayroll` cũ không còn mở quyền cho `TRAINING_MANAGER`; service/API/export
  đều kiểm tra role fail-closed. `LIVE_EMPLOYEE` chỉ có self-service payslip đã publish.
- Gửi phiếu là publish snapshot mới nhất. Sửa sau khi gửi không làm thay đổi bản
  nhân viên đang xem cho tới khi working revision được gửi lại.
- Không thêm production dependency.

## ADR-020 — Doanh số Live là xu và thưởng tháng dựa trên ngày làm việc

- Trạng thái: Accepted.
- `revenueAmount` trong schema cũ được giữ để tương thích dữ liệu và migration, nhưng
  contract/UI nghiệp vụ gọi rõ là `dailyCoins`/`monthlyCoins`. Giá trị là số xu nguyên,
  không phải VND và không có phép quy đổi ngầm.
- `MONTHLY_LEVEL_RULES` là nguồn duy nhất cho bảng mốc xu tháng. UI đơn giản ánh xạ vào
  cùng cấu hình typed hiện có; không tạo bảng hay rule type trùng lặp.
- Thưởng chuyên cần đếm ngày nghiệp vụ khác nhau có `PRESENT` và `workUnits > 0`.
  Work unit, thời lượng Live và tăng ca không được dùng để suy ra số ngày.
- Nguồn so bậc tháng trước ưu tiên snapshot payroll đã publish, rồi Attendance/Live,
  sau cùng mới dùng số xu nền nhập tay của worksheet. Dữ liệu nhập tay không sửa nguồn.
- Payroll snapshot giữ tổng xu, nguồn tháng trước, bậc hai tháng, số ngày và trạng thái
  `NONE/RETAIN/JUMP/DOWN`. Thưởng duy trì và thưởng nhảy bậc loại trừ nhau.
- Khi `employeeRevenueVisible=false`, API/DTO và file nhân viên loại toàn bộ giá trị
  doanh số/xu; việc ẩn ở UI không được coi là kiểm soát quyền.
- Không thêm production dependency và không cần reset/seed dữ liệu.

# Production hardening (Prompt 8)

- Giữ Better Auth 1.6.24 và pg-boss 12.26.2 hiện có; không thêm production dependency.
- Bật TOTP từ plugin chính thức của Better Auth, database rate-limit và account lockout.
- Chưa bật PostgreSQL RLS vì Prisma pooled connections chưa có request-scoped transaction
  context cho toàn bộ query. Quyết định và điều kiện triển khai lại nằm trong `security.md`.
- Web image chứa Prisma CLI/migrations để duy nhất web pre-deploy chạy migration; worker
  không có migration step. Đổi lại image web lớn hơn standalone-only image, nhưng loại bỏ
  race migration giữa services.
- Railway Bucket là private storage; signed URL vẫn phải qua application authorization.

## ADR-021 — Onboarding theo cơ sở, ca hiệu lực và CCCD riêng tư

- Trạng thái: Accepted.
- Training Manager được tạo hồ sơ nhân viên Live chỉ trong `activeBranchIds`; API
  chuyên biệt không nhận lương cơ bản, role, tài khoản hoặc `companyId`.
- Ca làm là dữ liệu có hiệu lực `[effectiveFrom, effectiveTo)`, chống overlap bằng
  constraint PostgreSQL và dùng số phút nguyên. Thay ca tạo khoảng mới, không ghi
  đè lịch sử đã dùng để tính lỗi.
- Rule tự động chỉ lưu nguồn ngưỡng và phút du di. Khi dùng `STAFF_SHIFT`, service
  resolve ca theo nhân viên/branch/ngày rồi snapshot ca vào violation; thiếu ca thì
  không phạt và trả cảnh báo có cấu trúc.
- Hai mặt CCCD dùng bảng riêng, private object storage và signed URL ngắn hạn sau
  authorization. DTO không trả `objectKey`, checksum hoặc URL lâu dài; lượt xem
  được ghi audit.
- Không tạo tài khoản đăng nhập khi manager onboard nhân viên và không thêm
  production dependency.

## ADR-022 — Lý do audit cho thao tác thường được sinh tại server

- Trạng thái: Accepted.
- Form thêm, sửa, lưu, import, export và hủy thông thường không yêu cầu người dùng nhập
  một ô “Lý do thay đổi”. Client không dùng nội dung tự do làm nguồn quyết định cho audit.
- Service sinh mô tả có cấu trúc bằng `systemAuditReason(action)`. Audit vẫn bắt buộc giữ
  actor, company/branch scope, action, entity, before/after, requestId, IP và user agent.
- Trường mang ý nghĩa nghiệp vụ thật vẫn được giữ, ví dụ chi tiết lỗi, ghi chú KPI,
  `overrideReason` khi Tổng quản lý đổi mức tiền phạt và lý do của khoản điều chỉnh lương.
- Thao tác nhạy cảm vẫn cần xác nhận rõ hậu quả và giữ authorization, optimistic lock,
  soft-delete/versioning; việc bỏ ô nhập tự do không làm yếu các kiểm soát này.
