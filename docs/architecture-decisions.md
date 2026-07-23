# Architecture Decision Records

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
