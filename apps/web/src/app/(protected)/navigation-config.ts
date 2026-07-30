import type { AuthRole } from "@ald/domain";

export type NavigationSection =
  | "Tổng quan"
  | "Vận hành"
  | "Quy định"
  | "Dữ liệu"
  | "Hệ thống"
  | "Cá nhân";

export type NavigationItem = Readonly<{
  href: string;
  label: string;
  shortLabel: string;
  description: string;
  section: NavigationSection;
  roles: readonly AuthRole[];
}>;

const navigationItems: readonly NavigationItem[] = [
  {
    href: "/dashboard",
    label: "Tổng quan",
    shortLabel: "TQ",
    description: "Các chỉ số và tác vụ cần chú ý",
    section: "Tổng quan",
    roles: ["GENERAL_MANAGER", "TRAINING_MANAGER", "LIVE_EMPLOYEE"],
  },
  {
    href: "/attendance",
    label: "Chấm công & Live",
    shortLabel: "CC",
    description: "Hồ sơ chấm công và chỉ số Live theo tháng",
    section: "Vận hành",
    roles: ["GENERAL_MANAGER", "TRAINING_MANAGER"],
  },
  {
    href: "/staff",
    label: "Nhân viên cơ sở",
    shortLabel: "NV",
    description: "Thêm nhân viên, ca làm và hồ sơ CCCD",
    section: "Vận hành",
    roles: ["GENERAL_MANAGER", "TRAINING_MANAGER"],
  },
  {
    href: "/branch-overview",
    label: "Tổng quan cơ sở",
    shortLabel: "CS",
    description: "Bảng tháng, doanh số và tổng hợp theo nhân viên",
    section: "Vận hành",
    roles: ["GENERAL_MANAGER", "TRAINING_MANAGER"],
  },
  {
    href: "/company-report",
    label: "Báo cáo công ty",
    shortLabel: "BC",
    description: "Báo cáo tổng hợp trong phạm vi được phân công",
    section: "Vận hành",
    roles: ["GENERAL_MANAGER", "TRAINING_MANAGER"],
  },
  {
    href: "/manager-kpi",
    label: "KPI quản lý",
    shortLabel: "KQ",
    description: "Đánh giá KPI quản lý đào tạo",
    section: "Vận hành",
    roles: ["GENERAL_MANAGER", "TRAINING_MANAGER"],
  },
  {
    href: "/rules",
    label: "Thưởng & phạt",
    shortLabel: "QP",
    description: "Thiết lập nhanh mốc thưởng và mức phạt",
    section: "Quy định",
    roles: ["GENERAL_MANAGER", "TRAINING_MANAGER"],
  },
  {
    href: "/payroll",
    label: "Payroll",
    shortLabel: "PL",
    description: "Tính, review, khóa và publish bảng lương",
    section: "Vận hành",
    roles: ["GENERAL_MANAGER"],
  },
  {
    href: "/my-payslips",
    label: "Phiếu lương của tôi",
    shortLabel: "PT",
    description: "Phiếu lương cá nhân đã được công bố",
    section: "Cá nhân",
    roles: ["LIVE_EMPLOYEE"],
  },
  {
    href: "/data-governance",
    label: "Import, Export & Audit",
    shortLabel: "DL",
    description: "Luân chuyển dữ liệu và nhật ký hệ thống",
    section: "Dữ liệu",
    roles: ["GENERAL_MANAGER"],
  },
  {
    href: "/administration",
    label: "Quản trị nền tảng",
    shortLabel: "QT",
    description: "Cơ sở, nhân sự, phân công và tài khoản",
    section: "Hệ thống",
    roles: ["GENERAL_MANAGER"],
  },
  {
    href: "/settings/security",
    label: "Bảo mật tài khoản",
    shortLabel: "BM",
    description: "Mật khẩu, phiên đăng nhập và xác thực hai lớp",
    section: "Cá nhân",
    roles: ["GENERAL_MANAGER", "TRAINING_MANAGER", "LIVE_EMPLOYEE"],
  },
] as const;

export function navigationForRole(
  role: AuthRole,
  _canManagePayroll = role === "GENERAL_MANAGER",
): readonly Omit<NavigationItem, "roles">[] {
  void _canManagePayroll;
  return navigationItems
    .filter((item) => item.roles.includes(role))
    .map((item) => ({
      href: item.href,
      label: item.label,
      shortLabel: item.shortLabel,
      description: item.description,
      section: item.section,
    }));
}

export function roleCanOpenPath(
  role: AuthRole,
  pathname: string,
  _canManagePayroll = role === "GENERAL_MANAGER",
): boolean {
  void _canManagePayroll;
  if (
    role === "TRAINING_MANAGER" &&
    ["/rules/configured", "/rules/penalties"].some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  ) {
    return false;
  }
  return navigationItems.some(
    (item) =>
      item.roles.includes(role) && (pathname === item.href || pathname.startsWith(`${item.href}/`)),
  );
}
