# Kế hoạch điều hướng ứng dụng

## Mục tiêu

Thay trang `/dashboard` đang mount nối tiếp mọi workspace bằng protected shell và các route
độc lập. Navigation chỉ quyết định khả năng hiển thị; từng page và API vẫn authorize trên
server bằng actor lấy từ session.

## Mapping workspace và quyền route

| Workspace hiện tại                        | Route mới            | GENERAL_MANAGER |             TRAINING_MANAGER             |          LIVE_EMPLOYEE          |
| ----------------------------------------- | -------------------- | :-------------: | :--------------------------------------: | :-----------------------------: |
| Tổng quan nhẹ theo vai trò                | `/dashboard`         |       Có        |                    Có                    |               Có                |
| `AttendanceWorkspace`                     | `/attendance`        |       Có        |             Có, branch scope             |              Không              |
| `BranchOverviewWorkspace`                 | `/branch-overview`   | Xem/sửa/export  |          Chỉ xem, branch scope           |              Không              |
| `CompanyIntelligenceWorkspace`            | `/company-report`    |       Có        | Chỉ vận hành, branch scope, không export |              Không              |
| `ManagerKpiWorkspace`                     | `/manager-kpi`       |       Có        |     Có, dữ liệu bản thân theo policy     |              Không              |
| `SimpleRulesWorkspace`                    | `/rules`             |     Editor      |        Quy định hiện hành chỉ đọc        |          Không có menu          |
| `ConfiguredRuleCenter`                    | `/rules/configured`  |     Editor      |                  Không                   |          Không có menu          |
| `PenaltyRuleCenter`                       | `/rules/penalties`   |     Editor      |                  Không                   |              Không              |
| `PayrollWorkspace`                        | `/payroll`           |  Admin payroll  |                  Không                   |              Không              |
| `DataGovernanceWorkspace`                 | `/data-governance`   |  Toàn công ty   |                  Không                   |              Không              |
| `FoundationAdmin`                         | `/administration`    |       Có        |                  Không                   |              Không              |
| `ChangePasswordForm`, `TwoFactorSettings` | `/settings/security` |   Có, gồm 2FA   |               Đổi mật khẩu               |          Đổi mật khẩu           |
| `PayrollWorkspace` chế độ self-service    | `/my-payslips`       |      Không      |                  Không                   | Payslip đã publish của bản thân |

## Kiến trúc

- Route group `(protected)` chứa layout server dùng chung và không thay đổi URL public.
- Layout chỉ redirect `/login` khi thiếu session; đổi mật khẩu là thao tác chủ động tại
  `/settings/security` hoặc `/change-password`.
- Client shell chỉ nhận identity tối thiểu: tên hiển thị, vai trò và số cơ sở trong scope.
- Typed navigation config là nguồn duy nhất cho menu, breadcrumb và active state.
- Mỗi page có server role guard riêng; direct URL trái quyền chuyển sang `/forbidden`.
- Các workspace cũ tiếp tục gọi API `no-store`; không chuyển Prisma hoặc business logic vào UI.
- Sidebar collapse chỉ là device preference trong `localStorage`, không tham gia authorization.

## UX

- Desktop: sidebar sticky, có thể thu gọn; content không bị giới hạn chiều rộng cho bảng tháng.
- Mobile: drawer modal, đóng bằng overlay, nút đóng hoặc phím `Escape`.
- Có skip link, `aria-current`, focus-visible, breadcrumb, loading, error và permission denied.
- Search params hiện có của từng workspace tiếp tục nằm trong route module tương ứng.

## Kiểm thử

- Unit test role-to-navigation mapping và active-route matching.
- E2E GM đi qua các module chính bằng sidebar.
- E2E manager/employee kiểm tra menu và direct URL deny.
- E2E mobile drawer, `Escape`, browser back/forward và heading riêng của từng route.
- Chạy format, lint, typecheck, unit, integration, E2E và production build.
