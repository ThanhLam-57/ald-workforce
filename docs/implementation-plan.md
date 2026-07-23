# Kế hoạch triển khai

## Phase 0 — Đặc tả và scaffold

- Chốt product requirements, permission matrix, data model/ERD, payroll contract, câu hỏi mở và architecture.
- Tạo pnpm/Turborepo, strict TypeScript, lint, Vitest, Playwright skeleton.
- Tạo Dockerfile web/worker, Compose PostgreSQL/MinIO.
- Exit: workspace scripts và build scaffold pass.

## Phase 1 — Foundation (phạm vi Prompt 0)

1. Prisma foundation migration và generated client.
2. Better Auth database session, email/username + password, không self-registration.
3. Actor context và RBAC/domain policy.
4. Application services/repositories cho branch, staff, user, assignment.
5. Audit skeleton cùng transaction và required reason.
6. GM/manager dashboard tối thiểu và API scoped.
7. Seed company + GM idempotent.
8. Liveness/readiness.
9. Unit test policy và integration test cross-company/cross-branch IDOR.
10. README local setup và Railway operations.

Exit:

- GM tạo/sửa branch, staff, user, assignment.
- TM chỉ liệt kê/xem branch và staff thuộc assignment hiệu lực.
- Test IDOR pass; audit create/update có before/after đã redaction.
- lint, typecheck, tests, build pass.

## Phase 2 — Attendance và Live metrics

Đã hoàn thành trong Prompt 1:

- Attendance day/live metric schema, unique staff/date, check constraints và archive.
- Hồ sơ ngày + lưới tháng dùng chung endpoint, autosave, 409 reload/merge và keyboard navigation.
- Employee error report skeleton không query/serialize revenue.
- Integration/E2E branch scope, GM/TM permission, timezone và optimistic concurrency.

## Phase 3 — Versioned rule center

Đã hoàn thành phần PENALTY trong Prompt 2:

- Typed RuleSet/RuleVersion/PenaltyItem và draft/clone/schedule/publish/retire.
- PostgreSQL no-overlap `[from,to)` và immutable published guard.
- Dropdown màu theo effective date, violation snapshot, GM override có lý do.
- Evidence private bằng presigned PUT + HEAD verify + authorized signed GET.
- Tổng phạt ngày/tháng và export báo lỗi không query/serialize revenue.
- Unit/integration/E2E cho boundary, snapshot, IDOR và immutable rule.

Rule thưởng/lương và employee self-service tiếp tục ở phase tương ứng.

## Phase 4 — Branch monthly overview

Đã hoàn thành trong Prompt 3:

- Projection trực tiếp từ attendance/live metric/active violations và level history, không lưu aggregate trùng.
- Grid 28–31 ngày với cột identity/totals sticky, horizontal virtualization, keyboard navigation và mobile read-only.
- Filters branch/month/status/category/level/search; chart doanh số theo nhân viên.
- Inline autosave, optimistic conflict, reload, batch paste TSV validate toàn vùng và audit reason.
- XLSX tiếng Việt với two-level header, typed numbers, frozen panes và export scope theo branch.
- Unit/integration/E2E cho totals, source write-through, IDOR, index và export không rò branch.

## Phase 5 — KPI quản lý

- Manager attendance.
- KPI template/version/criteria và weighted scoring pure functions.
- Draft/published review.
- GM/TM self-read permissions và audit.

## Phase 6 — Payroll

- Payroll schema/state machine.
- Pure config-driven calculator và golden tests.
- Calculate/review/adjust/lock/publish/revision.
- Snapshot/reconciliation và employee payslip read-only.
- XLSX/PDF export jobs.

## Phase 7 — Báo cáo, import/export và self-service

- Branch/company reports, weekly/monthly views và charts.
- Import preview/row validation/idempotent commit.
- Export center, signed URL.
- Employee self-service setting và field-level revenue permission.

## Phase 8 — Production hardening

- Load/performance test bảng tháng và report.
- Backup/restore drill, rollback drill.
- Observability/alerts, security review, dependency/secret scanning.
- Data retention, object scan/lifecycle và incident runbook.

## Chiến lược test

- Unit: authorization policy, interval logic, state machine, formula.
- Integration: PostgreSQL constraints, repository tenant scope, transaction/audit, auth session.
- E2E: login và các luồng chính theo role bằng Playwright.
- Golden: payroll/rule boundaries và rounding.
- Build gate mỗi phase: `pnpm lint`, `pnpm typecheck`, `pnpm test`, integration liên quan, `pnpm build`.

## Rủi ro và biện pháp

| Rủi ro                          | Biện pháp                                                                   |
| ------------------------------- | --------------------------------------------------------------------------- |
| IDOR chéo cơ sở                 | Actor scope từ DB; company/branch filter trong repository; integration test |
| Rule overlap/sai effective date | `[from,to)`, transaction lock + DB exclusion constraint                     |
| Sai số tiền                     | BIGINT, decimal policy, no floating point, reconciliation/golden tests      |
| Rò revenue/payroll              | Server DTO allow-list, endpoint/export test                                 |
| Audit thiếu hoặc lộ secret      | Audit cùng transaction, redaction central                                   |
| Web/worker tranh migration      | Release job duy nhất chạy `migrate deploy`                                  |
| Aggregate lệch source           | Không lưu bảng tháng trùng; trace source IDs                                |
| Import lặp                      | Idempotency key và per-row stable key                                       |
