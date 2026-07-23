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

## ADR-009 — Autosave optimistic concurrency

- Trạng thái: Accepted
- Quyết định: update/archive phải gửi version; update dùng compare-and-increment trong transaction. Conflict trả HTTP 409 kèm DTO `current` đã authorize để UI tải lại hoặc ghép thay đổi.
- Lý do: bảng tháng có nhiều người nhập đồng thời; last-write-wins sẽ làm mất dữ liệu mà không cảnh báo.

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
