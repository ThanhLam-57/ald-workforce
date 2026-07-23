# Railway deployment và vận hành

## 1. Topology

- `web`: public, build từ `apps/web/Dockerfile`.
- `worker`: private, build từ `apps/worker/Dockerfile`.
- PostgreSQL: private Railway database.
- Storage bucket: private, S3-compatible.
- Release/migration job: chạy một lần cho mỗi release, không chạy đồng thời trong web/worker.

## 2. Environment variables

Web và worker:

- `DATABASE_URL`
- `DATABASE_POOL_MAX`
- `BETTER_AUTH_SECRET` (chỉ web cần trực tiếp)
- `BETTER_AUTH_URL=https://<public-domain>`
- `NEXT_PUBLIC_APP_URL=https://<public-domain>`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`
- `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE`
- `S3_AUTO_CREATE_BUCKET` (`true` chỉ cho local/dev; production tạo bucket bằng hạ tầng)

Không commit secret. Dùng secret manager/environment của Railway. Bucket phải private và chặn public ACL/policy. CORS bucket chỉ cho origin web tin cậy, method `PUT`/`GET` và các header đã ký (`content-type`, `content-length`, `x-amz-checksum-sha256`, `x-amz-meta-sha256`).

## 3. Release flow

1. CI chạy lint, typecheck, unit/integration test và build.
2. Backup database trước migration có rủi ro.
3. Release job dùng cùng commit/image chạy:

```bash
pnpm --filter @ald/db db:deploy
```

4. Chỉ khi migration thành công mới deploy web/worker.
5. Railway healthcheck web trỏ `/api/health/ready`; liveness dùng `/api/health/live`.
6. Smoke test login, GM scoped query và worker connection.

Không cấu hình web/worker chạy `migrate deploy` trong startup command vì sẽ tạo race.

## 4. Backup

- Bật backup/snapshot tự động của Railway PostgreSQL theo RPO được phê duyệt.
- Tạo logical backup trước migration quan trọng:

```bash
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" > ald-YYYYMMDD-HHMM.dump
```

- Mã hóa backup, lưu private, giới hạn quyền, kiểm tra checksum và retention.
- Bucket bật versioning/lifecycle phù hợp; backup metadata database và object storage phải có cùng mốc.
- Hàng quý restore thử vào environment cô lập và ghi thời gian/RPO-RTO thực tế.

## 5. Restore

1. Tạo database đích trống cùng major PostgreSQL.
2. Cô lập web/worker khỏi database đích.
3. Restore:

```bash
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" ald.dump
```

4. Chạy `prisma migrate status`, kiểm tra constraint/index và row counts.
5. Kiểm tra login, tenant isolation, audit chain và reconciliation dữ liệu tài chính.
6. Đổi connection chỉ sau khi sign-off; giữ database cũ read-only trong cửa sổ rollback.

## 6. Rollback

- Application rollback: redeploy image/commit trước nếu schema mới backward-compatible.
- Database migration: ưu tiên forward-fix. Không tự động down migration có thể mất dữ liệu.
- Với migration destructive, bắt buộc expand/contract:
  1. thêm schema mới tương thích;
  2. deploy code dual-read/write nếu cần;
  3. backfill/verify;
  4. chuyển read;
  5. chỉ remove cột ở release sau và có backup.
- Khi cần point-in-time restore, dừng mutation, ghi mốc incident, restore sang database mới và reconcile các mutation sau mốc.

## 7. Security/operations checklist

- Web là service public duy nhất.
- Rotate Better Auth/S3/database credentials theo policy.
- Signed URL TTL ngắn; không log token/signed URL/password.
- Presigned evidence PUT hết hạn sau 5 phút; signed GET hết hạn sau 60 giây; complete phải `HEAD` verify MIME, size và SHA-256.
- Alert readiness failure, worker error rate, job retry/dead-letter và database saturation.
- Audit business là append-only; operational logs không chứa payload nhạy cảm.
- Kiểm tra định kỳ cross-company/cross-branch IDOR và export field redaction.
- Import PUT hết hạn sau 5 phút, tối đa 20 MiB và phải `HEAD` verify MIME/size/SHA-256
  trước khi parse. Source file luôn ở private bucket.
- `EXPORT_RETENTION_DAYS` mặc định 7, chỉ nhận 1–30. Worker đăng ký queue
  `data-export`, `export-cleanup` và cron cleanup 03:00 theo `Asia/Ho_Chi_Minh`.
