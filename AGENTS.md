# Repository instructions

## Mục tiêu

Xây dựng hệ thống nội bộ quản lý nhiều cơ sở, nhân viên Live, quản lý đào tạo, chấm công, KPI, doanh số, lỗi/phạt, thưởng và tính lương. Hệ thống phải bảo mật dữ liệu theo cơ sở và có lịch sử đầy đủ.

## Kiến trúc bắt buộc

- Monorepo pnpm + Turborepo.
- `apps/web`: Next.js App Router, TypeScript strict.
- `apps/worker`: Node.js worker xử lý export, job nền và tính toán dài.
- `packages/db`: Prisma + PostgreSQL.
- `packages/domain`: business rules thuần TypeScript, không phụ thuộc UI.
- `packages/contracts`: Zod schemas/DTO dùng chung.
- `packages/ui`: component dùng chung.
- Không tạo microservice riêng cho từng module.

## Quy tắc dữ liệu và bảo mật

- Mọi bảng nghiệp vụ phải có `companyId`; bảng theo cơ sở phải có `branchId`.
- Quản lý đào tạo chỉ được truy cập cơ sở đang được phân công. Không tin `branchId` do client gửi; lấy phạm vi từ session.
- Tổng quản lý được truy cập toàn công ty nhưng mọi sửa/xóa nhạy cảm phải ghi audit log và yêu cầu lý do.
- Nhân viên chỉ được xem dữ liệu của chính mình đã được publish.
- Không bao giờ chỉ ẩn trường nhạy cảm bằng CSS/UI. DTO/API/export phải loại bỏ trường không được phép ngay trên server.
- Không cache dùng chung dữ liệu có session/branch scope. Mọi cache phải có khóa theo company/branch/user hoặc dùng no-store.
- File ảnh/evidence nằm trong private object storage; chỉ cấp signed URL sau khi kiểm tra quyền.
- Không hard-delete attendance, violation, rule đã publish, payroll hoặc audit log. Dùng status/archive/revision.

## Quy tắc tính toán

- Tiền VND và doanh số nguyên lưu bằng PostgreSQL BIGINT; API serialize thành string khi cần.
- Thời lượng lưu bằng số phút nguyên. Công lưu Decimal, hỗ trợ 0.5, 1.0, v.v.
- Ngày nghiệp vụ dùng timezone `Asia/Ho_Chi_Minh`; timestamp lưu UTC.
- Không hardcode mức thưởng/phạt/lương trong UI hoặc controller.
- Rule đã publish là immutable. Muốn thay đổi phải tạo version mới với `effectiveFrom`/`effectiveTo`.
- Không dùng `eval`, `new Function` hoặc lưu JavaScript có thể thực thi trong database.
- Khi ghi vi phạm phải snapshot số tiền phạt và ruleVersion áp dụng tại ngày xảy ra.
- Khi khóa/publish payroll phải snapshot toàn bộ input, output, ruleVersion và breakdown.

## Tách lớp

- UI/route handler chỉ validate, authorize và gọi application/domain service.
- Business formula chỉ nằm trong `packages/domain` và phải là pure functions khi có thể.
- Không gọi Prisma trực tiếp từ React component.
- Mọi mutation nghiệp vụ phải chạy transaction phù hợp và ghi audit log.

## Chất lượng

- TypeScript strict; không dùng `any` trừ khi có giải thích cụ thể.
- Validate input bằng Zod.
- Unit test rule engine và payroll bằng bảng test biên.
- Integration test quyền truy cập chéo cơ sở/IDOR.
- E2E test các luồng chính bằng Playwright.
- Mỗi thay đổi phải chạy: lint, typecheck, unit test, integration test liên quan và build.
- Không đánh dấu hoàn thành nếu test chưa chạy hoặc còn lỗi TypeScript.

## UX

- Giao diện tiếng Việt, định dạng ngày `dd/MM/yyyy`, tiền theo `vi-VN`.
- Bảng tháng phải có sticky columns, horizontal scroll, keyboard navigation, trạng thái lưu rõ ràng và cảnh báo conflict. Riêng `/attendance` chỉ lưu khi người dùng bấm nút `Lưu thay đổi`.
- Luôn có loading, empty, error và permission-denied states.

## Quy tắc Git

- Mỗi phase là một commit/PR có phạm vi rõ ràng.
- Không thay đổi kiến trúc hoặc thêm production dependency lớn khi chưa ghi lý do trong `docs/architecture-decisions.md`.
- Trước khi kết thúc task, tự review diff cho lỗi bảo mật, rò dữ liệu chéo cơ sở, sai số tiền và sai effective date.
