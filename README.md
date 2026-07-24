# ALD Workforce

Hệ thống nội bộ nhiều cơ sở để quản lý nhân sự Live, chấm công, doanh số, KPI, lỗi/phạt,
rule có phiên bản, payroll, import/export và audit. API áp dụng company/branch scope ở
server; dữ liệu payroll, evidence và object storage không được công khai.

## Kiến trúc

- `apps/web`: Next.js App Router, Better Auth, API và giao diện tiếng Việt.
- `apps/worker`: pg-boss worker cho export, PDF/XLSX/ZIP và cleanup.
- `packages/db`: Prisma 7 + PostgreSQL.
- `packages/domain`: công thức và authorization thuần TypeScript.
- `packages/contracts`: Zod DTO dùng chung.
- `packages/ui`: UI components dùng chung.

Node.js được ghim ở `22.22.2`, pnpm `11.9.0`. Image production chạy non-root.

## Chạy local

1. Sao chép `.env.example` thành `.env`, thay toàn bộ `<placeholder>`.
2. Dùng giá trị PostgreSQL/MinIO khớp với `compose.yaml`, chỉ trong máy local.
3. Chạy:

```powershell
pnpm install --frozen-lockfile
docker compose up -d
pnpm db:deploy
$env:ALLOW_DEMO_SEED="true"
pnpm db:seed
pnpm dev
```

Web mặc định ở `http://localhost:3000`. Seed không in mật khẩu; tên đăng nhập và tên
biến môi trường chứa mật khẩu được ghi trong log. Không chạy demo seed trên production.

## Điều hướng theo vai trò

Sau khi đăng nhập, `/dashboard` hiển thị tổng quan gọn theo vai trò. Trên desktop dùng
sidebar bên trái; trên màn hình nhỏ dùng nút **Menu**. Mỗi module có URL riêng nên có thể
bookmark và dùng nút back/forward của trình duyệt. Server kiểm tra lại session, vai trò và
branch scope ở từng route; việc một mục không xuất hiện trong menu không phải là lớp bảo mật
duy nhất.

| Khu vực                     | URL                  | Quyền truy cập                                      |
| --------------------------- | -------------------- | --------------------------------------------------- |
| Tổng quan                   | `/dashboard`         | Tất cả vai trò, nội dung theo vai trò               |
| Chấm công & Live            | `/attendance`        | GM, Training Manager trong branch                   |
| Tổng quan cơ sở             | `/branch-overview`   | GM, Training Manager trong branch                   |
| Báo cáo công ty             | `/company-report`    | GM                                                  |
| KPI quản lý                 | `/manager-kpi`       | GM; Training Manager chỉ dữ liệu được phép          |
| Rule thưởng/level/lương/KPI | `/rules/configured`  | GM chỉnh sửa; Training Manager chỉ đọc active rule  |
| Rule phạt                   | `/rules/penalties`   | GM                                                  |
| Payroll                     | `/payroll`           | GM                                                  |
| Import/Export/Audit         | `/data-governance`   | GM; Training Manager chỉ Import/Export trong branch |
| Quản trị nền tảng           | `/administration`    | GM                                                  |
| Phiếu lương cá nhân         | `/my-payslips`       | Live Employee, chỉ phiếu đã publish của mình        |
| Bảo mật tài khoản           | `/settings/security` | Tất cả vai trò                                      |

## Kiểm tra bắt buộc

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

Integration/E2E cần PostgreSQL và S3-compatible private storage. Cài Chromium một lần:

```powershell
pnpm --filter @ald/web exec playwright install chromium
```

## Production

- Liveness: `GET /api/health/live`
- Readiness DB + worker queue: `GET /api/health/ready`
- Metrics: `GET /api/health/metrics`, production yêu cầu `Bearer $METRICS_TOKEN`
- Worker: `/health/live`, `/health/ready` trên private service
- Trạng thái queue/job cho GM: `GET /api/operations/jobs`

Railway dùng [Dockerfile.web](Dockerfile.web), [Dockerfile.worker](Dockerfile.worker),
[railway.web.json](railway.web.json) và [railway.worker.json](railway.worker.json).
Migration chỉ chạy từ pre-deploy command của web; worker không chạy migration.

## Tài liệu vận hành

- [Triển khai Railway](docs/deployment-railway.md)
- [Bảo mật](docs/security.md)
- [Backup/restore](docs/backup-restore.md)
- [Hướng dẫn quản trị](docs/admin-guide.md)
- [Hướng dẫn quản lý đào tạo](docs/manager-guide.md)
- [Vận hành payroll](docs/payroll-operations.md)
- [Công thức payroll](docs/payroll-formulas.md)
- [Permission matrix](docs/permission-matrix.md)
- [Kiến trúc và ADR](docs/architecture.md)
