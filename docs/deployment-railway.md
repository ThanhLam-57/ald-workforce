# Triển khai Railway

## Topology

Tạo hai environment độc lập `staging` và `production`. Mỗi environment có:

| Service          | Network       | Config                                     |
| ---------------- | ------------- | ------------------------------------------ |
| `web`            | Public domain | `railway.web.json`, `Dockerfile.web`       |
| `worker`         | Private       | `railway.worker.json`, `Dockerfile.worker` |
| `PostgreSQL`     | Private       | Railway PostgreSQL                         |
| `Storage Bucket` | Private       | Railway Bucket, S3-compatible              |

Không gắn public domain cho worker, PostgreSQL hoặc bucket. Railway Bucket là private
theo mặc định; ứng dụng chỉ phát signed URL sau authorization.

## Thiết lập service

1. Kết nối cùng một GitHub repository cho web và worker.
2. Ở web đặt custom config file `/railway.web.json`; worker dùng
   `/railway.worker.json`.
3. Web dùng pre-deploy command
   `node packages/db/node_modules/prisma/build/index.js migrate deploy --config packages/db/prisma.config.ts`.
   Không cấu hình migration ở worker hoặc start command.
4. Tạo PostgreSQL và Bucket trong cùng environment.
5. Map biến môi trường bằng Railway reference variables; không sao chép secret vào repo.

Biến bắt buộc:

```text
DATABASE_URL
DATABASE_POOL_MAX
BETTER_AUTH_SECRET
BETTER_AUTH_URL
NEXT_PUBLIC_APP_URL
TRUSTED_ORIGINS
METRICS_TOKEN
S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_ACCESS_KEY
S3_SECRET_KEY
S3_FORCE_PATH_STYLE
S3_AUTO_CREATE_BUCKET=false
EXPORT_RETENTION_DAYS
```

Map Railway Bucket reference variables explicitly:

```text
S3_BUCKET=${{Bucket.BUCKET}}
S3_ACCESS_KEY=${{Bucket.ACCESS_KEY_ID}}
S3_SECRET_KEY=${{Bucket.SECRET_ACCESS_KEY}}
S3_REGION=${{Bucket.REGION}}
S3_ENDPOINT=${{Bucket.ENDPOINT}}
S3_FORCE_PATH_STYLE=false
```

`Bucket` is the Railway service name; update the prefix if the service has another name.
Use the values shown on the bucket's **Credentials** tab as the source of truth. New Railway
buckets use virtual-hosted-style S3 addressing, so keep `S3_FORCE_PATH_STYLE=false`; do not copy
the local MinIO value from `.env.example`.

`BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` và `TRUSTED_ORIGINS` phải là HTTPS domain chính
xác định trước khi deploy production. Mỗi environment dùng auth secret, metrics token và
storage credentials riêng.

## Bootstrap tài khoản Tổng quản lý

Production không chạy demo seed. Lần deploy đầu tiên, đặt các Railway Variables sau trên
service `web`:

```text
BOOTSTRAP_ADMIN_ENABLED=true
BOOTSTRAP_COMPANY_NAME=ALD
BOOTSTRAP_COMPANY_SLUG=ald
BOOTSTRAP_REVENUE_UNIT=COIN
BOOTSTRAP_ADMIN_STAFF_CODE=GM001
BOOTSTRAP_ADMIN_NAME=Tổng quản lý
BOOTSTRAP_ADMIN_EMAIL=admin@ald.local
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=<strong-temporary-password>
```

Pre-deploy command chạy migration rồi tạo duy nhất công ty, hồ sơ GM và tài khoản admin.
Lệnh này không tạo cơ sở, nhân viên, rule, attendance hoặc payroll demo. Sau khi deployment
đầu tiên thành công:

1. Đặt `BOOTSTRAP_ADMIN_ENABLED=false`.
2. Redeploy service `web`.
3. Đăng nhập bằng mật khẩu tạm, đổi mật khẩu ngay và bật 2FA.
4. Xóa `BOOTSTRAP_ADMIN_PASSWORD` khỏi Railway Variables sau khi xác nhận đăng nhập được.

## Trình tự release

1. CI phải pass lint, typecheck, unit, integration, build và E2E.
2. Deploy staging từ commit đã duyệt.
3. Kiểm tra `/api/health/live`, `/api/health/ready`, worker `/health/ready`.
4. Chạy smoke test GM/manager, export và signed evidence URL.
5. Promote đúng commit/image sang production.
6. Xác nhận migration trong deployment log và ghi release SHA vào nhật ký vận hành.

Pre-deploy failure chặn release; schema cũ vẫn phục vụ traffic. Migration phải
backward-compatible với phiên bản web đang chạy. Với thay đổi phá vỡ, dùng expand/migrate/
contract qua nhiều release.

## Domain, TLS và seed

Railway cấp TLS cho custom domain sau khi DNS xác thực. Chỉ bật production URL trong
trusted origins sau khi certificate hoạt động.

Demo seed chỉ được dùng ở local hoặc staging cô lập:

```text
ALLOW_DEMO_SEED=true
SEED_GM_PASSWORD=<secret>
SEED_MANAGER_PASSWORD=<secret-khác>
SEED_EMPLOYEE_PASSWORD=<secret-khác>
```

Không chạy seed trên production. Provision GM production bằng quy trình bootstrap một lần,
đổi mật khẩu ngay và bật 2FA; xóa/rotate bootstrap secret sau đó.

## Rollback

- Rollback code: redeploy deployment tốt gần nhất. Không rollback migration bằng cách sửa
  database thủ công.
- Nếu migration additive: phiên bản cũ phải vẫn đọc được schema mới.
- Nếu dữ liệu bị hỏng: dừng mutation, tạo PITR fork tại thời điểm trước sự cố, xác minh,
  rồi chuyển `DATABASE_URL` theo runbook backup/restore.
- File đã xuất có retention; không dùng export làm nguồn khôi phục database.

Tham khảo Railway:
[config as code](https://docs.railway.com/config-as-code),
[pre-deploy command](https://docs.railway.com/deployments/pre-deploy-command),
[monorepo](https://docs.railway.com/deployments/monorepo),
[Dockerfile](https://docs.railway.com/builds/dockerfiles),
[storage buckets](https://docs.railway.com/storage-buckets).
