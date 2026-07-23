# ALD Workforce

Ứng dụng nội bộ quản lý nhiều cơ sở, nhân sự, chấm công, KPI, doanh số và tính lương. Hiện hệ thống có Better Auth database session, RBAC theo company/branch, attendance + Live metrics theo tháng, rule phạt có version, violation snapshot, evidence private, branch monthly overview có biểu đồ/inline edit và các export XLSX an toàn theo scope. KPI và payroll chưa được triển khai.

## Yêu cầu

- Node.js 22 LTS (tối thiểu 22.13; Docker ghim 22.22.2)
- pnpm 11 qua Corepack
- Docker Desktop

## Chạy local

```powershell
Copy-Item .env.example .env
Copy-Item .env.example apps/web/.env.local
corepack enable
pnpm install
docker compose up -d --build
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Mở `http://localhost:3000`. Tài khoản seed mặc định:

- email: `admin@ald.local`
- username: `admin`
- password lấy từ `SEED_GM_PASSWORD` trong `.env`

Đổi password/secret mặc định trước khi dùng ngoài máy local. Seed idempotent: chạy lại không tạo trùng company/staff/user và không tự reset password của user đã tồn tại.

PostgreSQL local bind `127.0.0.1:55432` để tránh xung đột instance mặc định. MinIO API/console bind `127.0.0.1:9000/9001`; image community được build từ source release đã ghim trong `infra/minio/Dockerfile`.

## Lệnh kiểm tra

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

Integration tests yêu cầu PostgreSQL + MinIO từ Compose và dùng `DATABASE_URL`, `S3_*` trong `.env`. Lần đầu chạy E2E:

```powershell
pnpm --filter @ald/web exec playwright install chromium
```

## Database

```powershell
pnpm db:generate
pnpm db:migrate
pnpm db:deploy
pnpm db:seed
```

Development dùng `prisma migrate dev`; release chỉ dùng `prisma migrate deploy` từ một release job duy nhất. Web và worker không tự chạy migration khi start.

## API hiện có

- `GET /api/health/live`
- `GET /api/health/ready`
- `GET /api/me`
- `GET|POST /api/branches`
- `GET|PATCH /api/branches/:id`
- `GET|POST /api/staff`
- `PATCH /api/staff/:id`
- `POST /api/assignments`
- `PATCH /api/assignments/:id`
- `POST /api/users`
- `PATCH /api/users/:id`
- `GET|POST /api/attendance`
- `PATCH|DELETE /api/attendance/:id` (`DELETE` là archive, không hard-delete)
- `GET|POST /api/rules/penalty`
- `POST /api/rules/penalty/drafts`
- `PATCH /api/rules/penalty/versions/:id`
- `POST /api/rules/penalty/versions/:id/publish|retire`
- `GET /api/rules/penalty/active?date`
- `GET /api/rules/penalty/compare`
- `POST /api/violations`
- `DELETE /api/violations/:id` (`DELETE` là cancel, không hard-delete)
- `POST /api/evidence/presign`
- `POST /api/evidence/:id/complete`
- `GET /api/evidence/:id/view`
- `GET /api/exports/employee-error-report`
- `GET|PATCH /api/branch-overview`
- `GET /api/exports/branch-monthly-overview`

Mọi response nghiệp vụ authenticated dùng `private, no-store`. Mutation nhạy cảm yêu cầu `reason`, bản ghi mutable dùng optimistic version và ghi audit before/after. Tiền/doanh số được serialize thành string; ngày nghiệp vụ dùng `Asia/Ho_Chi_Minh`. Rule đã publish là bất biến, khoảng hiệu lực là `[effectiveFrom, effectiveTo)`. Evidence chỉ vào bucket private qua presigned PUT 5 phút, được `HEAD` xác minh MIME/kích thước/SHA-256 và chỉ cấp signed GET 60 giây sau authorization. Branch overview không có bảng tổng nhập liệu riêng: mọi edit ghi trực tiếp về attendance/live metric nguồn và export chỉ dùng projection đã authorize.

## Tài liệu

- [Product requirements](docs/product-requirements.md)
- [Permission matrix](docs/permission-matrix.md)
- [Data model/ERD](docs/data-model.md)
- [Payroll formula contract](docs/payroll-formulas.md)
- [Open questions](docs/open-questions.md)
- [Architecture](docs/architecture.md)
- [Implementation plan](docs/implementation-plan.md)
- [Architecture decisions](docs/architecture-decisions.md)
- [Deployment/operations](docs/deployment.md)
