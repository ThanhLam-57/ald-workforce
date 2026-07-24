"use client";

import type {
  AdminAssignmentDto,
  AdminBranchDto,
  AdminPageDto,
  AdminStaffDto,
  AdminUserDto,
} from "@ald/contracts";
import { Button } from "@ald/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

type Option = Readonly<{ id: string; label: string }>;
type Tab = "branches" | "staff" | "assignments" | "users";
type PageData =
  | AdminPageDto<AdminBranchDto>
  | AdminPageDto<AdminStaffDto>
  | AdminPageDto<AdminAssignmentDto>
  | AdminPageDto<AdminUserDto>;

const tabs: readonly Readonly<{ id: Tab; label: string; description: string }>[] = [
  { id: "branches", label: "Cơ sở", description: "Điểm vận hành và trạng thái hoạt động" },
  { id: "staff", label: "Nhân viên", description: "Hồ sơ, việc làm và tài khoản liên kết" },
  { id: "assignments", label: "Phân công", description: "Khoảng hiệu lực tại từng cơ sở" },
  { id: "users", label: "Tài khoản", description: "Vai trò và quyền đăng nhập hệ thống" },
];

const employmentCategoryLabels = {
  OFFICIAL: "Chính thức",
  PROBATION: "Thử việc",
  CONTRACTOR: "Hợp đồng",
  INTERN: "Thực tập",
} as const;

const employmentStatusLabels = {
  ACTIVE: "Đang làm",
  ON_LEAVE: "Tạm nghỉ",
  TERMINATED: "Đã nghỉ",
} as const;

const assignmentTypeLabels = {
  MEMBER: "Nhân viên cơ sở",
  PRIMARY_MANAGER: "Quản lý chính",
  SECONDARY_MANAGER: "Quản lý hỗ trợ",
} as const;

const assignmentStatusLabels = {
  CURRENT: "Đang hiệu lực",
  UPCOMING: "Sắp hiệu lực",
  ENDED: "Đã kết thúc",
  CANCELLED: "Đã hủy",
} as const;

const roleLabels = {
  GENERAL_MANAGER: "Tổng quản lý",
  TRAINING_MANAGER: "Quản lý đào tạo",
  LIVE_EMPLOYEE: "Nhân viên Live",
} as const;

function activeTab(value: string | null): Tab {
  return tabs.some(({ id }) => id === value) ? (value as Tab) : "branches";
}

function apiError(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }
  return "Không thể xử lý yêu cầu.";
}

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function businessDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function Badge({
  children,
  tone = "slate",
}: Readonly<{ children: ReactNode; tone?: "green" | "amber" | "rose" | "sky" | "slate" }>) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
    sky: "bg-sky-50 text-sky-700 ring-sky-200",
    slate: "bg-slate-100 text-slate-600 ring-slate-200",
  } as const;
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function Drawer({
  children,
  onClose,
  title,
}: Readonly<{ children: ReactNode; onClose: () => void; title: string }>) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const elements = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <button
        aria-label="Đóng biểu mẫu"
        className="absolute inset-0 bg-slate-950/35"
        onClick={onClose}
        type="button"
      />
      <section
        aria-labelledby="administration-drawer-title"
        aria-modal="true"
        className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl"
        ref={panelRef}
        role="dialog"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
              Quản trị nền tảng
            </p>
            <h2 className="mt-1 text-xl font-semibold" id="administration-drawer-title">
              {title}
            </h2>
          </div>
          <button
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            Đóng
          </button>
        </div>
        <div className="p-6">{children}</div>
      </section>
    </div>
  );
}

function FormField({ children, label }: Readonly<{ children: ReactNode; label: string }>) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      {label}
      {children}
    </label>
  );
}

function CreateForm({
  branches,
  onSaved,
  staff,
  tab,
}: Readonly<{
  branches: readonly Option[];
  onSaved: (message: string) => void;
  staff: readonly Option[];
  tab: Tab;
}>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const configurations = {
      branches: {
        path: "/api/branches",
        success: "Đã tạo cơ sở.",
        body: {
          code: field(form, "code"),
          name: field(form, "name"),
          address: field(form, "address") || undefined,
          reason: field(form, "reason"),
        },
      },
      staff: {
        path: "/api/staff",
        success: "Đã tạo nhân viên.",
        body: {
          staffCode: field(form, "staffCode"),
          fullName: field(form, "fullName"),
          streamingAlias: field(form, "streamingAlias") || null,
          email: field(form, "email") || undefined,
          phone: field(form, "phone") || undefined,
          jobTitle: field(form, "jobTitle"),
          employmentCategory: field(form, "employmentCategory"),
          reason: field(form, "reason"),
        },
      },
      assignments: {
        path: "/api/assignments",
        success: "Đã tạo phân công.",
        body: {
          staffId: field(form, "staffId"),
          branchId: field(form, "branchId"),
          assignmentType: field(form, "assignmentType"),
          effectiveFrom: field(form, "effectiveFrom"),
          effectiveTo: field(form, "effectiveTo") || null,
          reason: field(form, "reason"),
        },
      },
      users: {
        path: "/api/users",
        success: "Đã cấp tài khoản và bật yêu cầu đổi mật khẩu.",
        body: {
          email: field(form, "email"),
          username: field(form, "username"),
          password: field(form, "password"),
          name: field(form, "name"),
          role: field(form, "role"),
          staffId: field(form, "staffId") || null,
          reason: field(form, "reason"),
        },
      },
    } as const;
    const configuration = configurations[tab];
    setPending(true);
    setError(null);
    try {
      const response = await fetch(configuration.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configuration.body),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiError(payload));
      onSaved(configuration.success);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể lưu dữ liệu.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      {tab === "branches" ? (
        <>
          <FormField label="Mã cơ sở">
            <input name="code" placeholder="VD: HN01" required />
          </FormField>
          <FormField label="Tên cơ sở">
            <input name="name" required />
          </FormField>
          <FormField label="Địa chỉ">
            <textarea name="address" rows={3} />
          </FormField>
        </>
      ) : null}

      {tab === "staff" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Mã nhân viên">
              <input name="staffCode" required />
            </FormField>
            <FormField label="Họ và tên">
              <input name="fullName" required />
            </FormField>
            <FormField label="ACC / alias Live">
              <input name="streamingAlias" />
            </FormField>
            <FormField label="Vị trí công việc">
              <input name="jobTitle" required />
            </FormField>
            <FormField label="Email">
              <input name="email" type="email" />
            </FormField>
            <FormField label="Số điện thoại">
              <input name="phone" />
            </FormField>
          </div>
          <FormField label="Loại hình nhân sự">
            <select defaultValue="OFFICIAL" name="employmentCategory">
              {Object.entries(employmentCategoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
        </>
      ) : null}

      {tab === "assignments" ? (
        <>
          <FormField label="Nhân viên">
            <select name="staffId" required>
              <option value="">Chọn nhân viên</option>
              {staff.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Cơ sở">
            <select name="branchId" required>
              <option value="">Chọn cơ sở</option>
              {branches.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Loại phân công">
            <select defaultValue="MEMBER" name="assignmentType">
              {Object.entries(assignmentTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Hiệu lực từ">
              <input defaultValue={businessDate()} name="effectiveFrom" required type="date" />
            </FormField>
            <FormField label="Hiệu lực đến (không bắt buộc)">
              <input name="effectiveTo" type="date" />
            </FormField>
          </div>
        </>
      ) : null}

      {tab === "users" ? (
        <>
          <FormField label="Tên hiển thị">
            <input name="name" required />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Email đăng nhập">
              <input name="email" required type="email" />
            </FormField>
            <FormField label="Tên đăng nhập">
              <input name="username" required />
            </FormField>
          </div>
          <FormField label="Mật khẩu tạm">
            <input
              autoComplete="new-password"
              minLength={12}
              name="password"
              required
              type="password"
            />
          </FormField>
          <FormField label="Vai trò">
            <select defaultValue="LIVE_EMPLOYEE" name="role">
              {Object.entries(roleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Liên kết nhân viên">
            <select name="staffId">
              <option value="">Không liên kết</option>
              {staff.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            Tài khoản mới phải đổi mật khẩu ngay lần đăng nhập đầu tiên.
          </p>
        </>
      ) : null}

      <FormField label="Lý do thao tác">
        <textarea name="reason" required rows={3} />
      </FormField>
      {error ? (
        <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
      <Button disabled={pending}>{pending ? "Đang lưu…" : "Lưu dữ liệu"}</Button>
    </form>
  );
}

function TableShell({
  children,
  empty,
  loading,
}: Readonly<{ children: ReactNode; empty: boolean; loading: boolean }>) {
  if (loading) {
    return (
      <div aria-live="polite" className="grid gap-3 py-6">
        {[1, 2, 3, 4].map((item) => (
          <div className="h-14 animate-pulse rounded-xl bg-slate-100" key={item} />
        ))}
      </div>
    );
  }
  if (empty) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-14 text-center">
        <p className="font-semibold text-slate-800">Không có dữ liệu phù hợp</p>
        <p className="mt-1 text-sm text-slate-500">Hãy đổi bộ lọc hoặc tạo bản ghi mới.</p>
      </div>
    );
  }
  return <>{children}</>;
}

function BranchRows({ items }: Readonly<{ items: readonly AdminBranchDto[] }>) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Cơ sở</th>
              <th className="px-4 py-3">Địa chỉ</th>
              <th className="px-4 py-3">Nhân viên</th>
              <th className="px-4 py-3">Quản lý</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3">Cập nhật</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr className="border-t border-slate-100" key={item.id}>
                <td className="px-4 py-4">
                  <strong>{item.code}</strong>
                  <span className="ml-2 text-slate-600">{item.name}</span>
                </td>
                <td className="max-w-xs px-4 py-4 text-slate-600">{item.address ?? "—"}</td>
                <td className="px-4 py-4">{item.activeStaffCount}</td>
                <td className="px-4 py-4">{item.activeManagerCount}</td>
                <td className="px-4 py-4">
                  <Badge tone={item.isActive ? "green" : "slate"}>
                    {item.isActive ? "Hoạt động" : "Ngừng hoạt động"}
                  </Badge>
                </td>
                <td className="px-4 py-4 text-slate-500">{dateTime(item.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 md:hidden">
        {items.map((item) => (
          <article className="rounded-xl border border-slate-200 p-4" key={item.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{item.code}</p>
                <p className="text-sm text-slate-600">{item.name}</p>
              </div>
              <Badge tone={item.isActive ? "green" : "slate"}>
                {item.isActive ? "Hoạt động" : "Đã ngừng"}
              </Badge>
            </div>
            <p className="mt-3 text-sm text-slate-500">{item.address ?? "Chưa có địa chỉ"}</p>
            <p className="mt-2 text-sm">
              {item.activeStaffCount} nhân viên · {item.activeManagerCount} quản lý
            </p>
          </article>
        ))}
      </div>
    </>
  );
}

function StaffRows({ items }: Readonly<{ items: readonly AdminStaffDto[] }>) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Nhân viên</th>
              <th className="px-4 py-3">Vị trí</th>
              <th className="px-4 py-3">Cơ sở hiện tại</th>
              <th className="px-4 py-3">Loại / trạng thái</th>
              <th className="px-4 py-3">Tài khoản</th>
              <th className="px-4 py-3">Level</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr className="border-t border-slate-100 align-top" key={item.id}>
                <td className="px-4 py-4">
                  <strong>{item.staffCode}</strong>
                  <p>{item.fullName}</p>
                  <p className="text-xs text-slate-500">{item.streamingAlias ?? "Không có ACC"}</p>
                </td>
                <td className="px-4 py-4">
                  {item.jobTitle}
                  <p className="text-xs text-slate-500">{item.email ?? "—"}</p>
                </td>
                <td className="px-4 py-4">
                  {item.currentAssignments.length
                    ? item.currentAssignments.map(({ branchCode }) => branchCode).join(", ")
                    : "Chưa phân công"}
                </td>
                <td className="px-4 py-4">
                  <p>{employmentCategoryLabels[item.employmentCategory]}</p>
                  <Badge
                    tone={
                      item.employmentStatus === "ACTIVE"
                        ? "green"
                        : item.employmentStatus === "ON_LEAVE"
                          ? "amber"
                          : "slate"
                    }
                  >
                    {employmentStatusLabels[item.employmentStatus]}
                  </Badge>
                </td>
                <td className="px-4 py-4">
                  {item.user ? (
                    <Badge tone={item.user.active ? "sky" : "slate"}>
                      {item.user.username ?? "Đã liên kết"}
                    </Badge>
                  ) : (
                    "Chưa có"
                  )}
                </td>
                <td className="px-4 py-4">{item.level?.code ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 md:hidden">
        {items.map((item) => (
          <article className="rounded-xl border border-slate-200 p-4" key={item.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">
                  {item.staffCode} · {item.fullName}
                </p>
                <p className="text-sm text-slate-500">{item.jobTitle}</p>
              </div>
              <Badge tone={item.employmentStatus === "ACTIVE" ? "green" : "slate"}>
                {employmentStatusLabels[item.employmentStatus]}
              </Badge>
            </div>
            <p className="mt-3 text-sm">
              {item.currentAssignments.map(({ branchCode }) => branchCode).join(", ") ||
                "Chưa phân công"}
            </p>
          </article>
        ))}
      </div>
    </>
  );
}

function AssignmentRows({ items }: Readonly<{ items: readonly AdminAssignmentDto[] }>) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Nhân viên</th>
            <th className="px-4 py-3">Cơ sở</th>
            <th className="px-4 py-3">Loại</th>
            <th className="px-4 py-3">Hiệu lực</th>
            <th className="px-4 py-3">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr className="border-t border-slate-100" key={item.id}>
              <td className="px-4 py-4">
                <strong>{item.staff.staffCode}</strong>
                <p>{item.staff.fullName}</p>
              </td>
              <td className="px-4 py-4">
                {item.branch.code} · {item.branch.name}
              </td>
              <td className="px-4 py-4">{assignmentTypeLabels[item.assignmentType]}</td>
              <td className="px-4 py-4">
                {item.effectiveFrom} → {item.effectiveTo ?? "Không thời hạn"}
              </td>
              <td className="px-4 py-4">
                <Badge
                  tone={
                    item.status === "CURRENT"
                      ? "green"
                      : item.status === "UPCOMING"
                        ? "sky"
                        : "slate"
                  }
                >
                  {assignmentStatusLabels[item.status]}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRows({ items }: Readonly<{ items: readonly AdminUserDto[] }>) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Tài khoản</th>
            <th className="px-4 py-3">Vai trò</th>
            <th className="px-4 py-3">Nhân viên liên kết</th>
            <th className="px-4 py-3">Trạng thái</th>
            <th className="px-4 py-3">Mật khẩu tạm</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr className="border-t border-slate-100" key={item.id}>
              <td className="px-4 py-4">
                <strong>{item.name}</strong>
                <p>{item.username ?? "—"}</p>
                <p className="text-xs text-slate-500">{item.email}</p>
              </td>
              <td className="px-4 py-4">{roleLabels[item.role]}</td>
              <td className="px-4 py-4">
                {item.staff ? `${item.staff.staffCode} · ${item.staff.fullName}` : "Chưa liên kết"}
              </td>
              <td className="px-4 py-4">
                <Badge tone={item.active ? "green" : "slate"}>
                  {item.active ? "Hoạt động" : "Vô hiệu hóa"}
                </Badge>
              </td>
              <td className="px-4 py-4">{item.mustChangePassword ? "Bắt buộc đổi" : "Đã đổi"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdministrationWorkspace({
  branchOptions,
  staffOptions,
}: Readonly<{ branchOptions: readonly Option[]; staffOptions: readonly Option[] }>) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = activeTab(searchParams.get("tab"));
  const queryString = searchParams.toString();
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const currentTab = tabs.find(({ id }) => id === tab)!;

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(queryString);
      params.delete("tab");
      setLoading(true);
      setError(null);
      fetch(`/api/administration/${tab}?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload: unknown = await response.json();
          if (!response.ok) throw new Error(apiError(payload));
          return payload as { data: PageData };
        })
        .then((payload) => setData(payload.data))
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          setError(caught instanceof Error ? caught.message : "Không thể tải dữ liệu quản trị.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [queryString, refreshKey, tab]);

  function updateParams(updates: Readonly<Record<string, string | null>>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value || value === "ALL") params.delete(key);
      else params.set(key, value);
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function selectTab(next: Tab) {
    setData(null);
    setMessage(null);
    setDrawerOpen(false);
    router.push(`${pathname}?tab=${next}`, { scroll: false });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateParams({ search: field(new FormData(event.currentTarget), "search"), page: null });
  }

  function saved(successMessage: string) {
    setDrawerOpen(false);
    setMessage(successMessage);
    setRefreshKey((value) => value + 1);
    router.refresh();
  }

  const title = useMemo(() => `Thêm ${currentTab.label.toLocaleLowerCase("vi-VN")}`, [currentTab]);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="mt-8 space-y-5">
      <div className="overflow-x-auto border-b border-slate-200">
        <div aria-label="Loại dữ liệu quản trị" className="flex min-w-max gap-1" role="tablist">
          {tabs.map((item) => (
            <button
              aria-selected={item.id === tab}
              className={`border-b-2 px-4 py-3 text-left text-sm transition ${
                item.id === tab
                  ? "border-sky-700 font-semibold text-sky-800"
                  : "border-transparent text-slate-500 hover:text-slate-900"
              }`}
              key={item.id}
              onClick={() => selectTab(item.id)}
              role="tab"
              type="button"
            >
              <span className="block">{item.label}</span>
              <span className="mt-0.5 hidden text-xs font-normal text-slate-400 lg:block">
                {item.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
              {currentTab.label}
            </p>
            <h2 className="mt-1 text-xl font-semibold">{currentTab.description}</h2>
            {data ? (
              <p className="mt-1 text-sm text-slate-500">{data.total} bản ghi phù hợp</p>
            ) : null}
          </div>
          <Button onClick={() => setDrawerOpen(true)}>Thêm {currentTab.label.toLowerCase()}</Button>
        </div>

        <div className="space-y-4 border-b border-slate-200 p-5">
          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={submitSearch}>
            <label className="flex-1 text-sm font-medium text-slate-700">
              Tìm kiếm
              <input
                className="mt-1 w-full"
                defaultValue={searchParams.get("search") ?? ""}
                key={`${tab}-${searchParams.get("search") ?? ""}`}
                name="search"
                placeholder={
                  tab === "staff"
                    ? "Mã, tên, alias hoặc email"
                    : tab === "users"
                      ? "Tên, username hoặc email"
                      : "Mã hoặc tên"
                }
              />
            </label>
            <Button className="self-end" type="submit">
              Tìm
            </Button>
          </form>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {tab === "branches" ? (
              <FormField label="Trạng thái">
                <select
                  onChange={(event) => updateParams({ status: event.target.value, page: null })}
                  value={searchParams.get("status") ?? "ALL"}
                >
                  <option value="ALL">Tất cả</option>
                  <option value="ACTIVE">Hoạt động</option>
                  <option value="INACTIVE">Ngừng hoạt động</option>
                </select>
              </FormField>
            ) : null}
            {tab === "staff" ? (
              <>
                <FormField label="Trạng thái việc làm">
                  <select
                    onChange={(event) =>
                      updateParams({ employmentStatus: event.target.value, page: null })
                    }
                    value={searchParams.get("employmentStatus") ?? "ALL"}
                  >
                    <option value="ALL">Tất cả</option>
                    {Object.entries(employmentStatusLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Loại nhân sự">
                  <select
                    onChange={(event) =>
                      updateParams({ employmentCategory: event.target.value, page: null })
                    }
                    value={searchParams.get("employmentCategory") ?? "ALL"}
                  >
                    <option value="ALL">Tất cả</option>
                    {Object.entries(employmentCategoryLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </FormField>
              </>
            ) : null}
            {tab === "assignments" ? (
              <>
                <FormField label="Hiệu lực">
                  <select
                    onChange={(event) => updateParams({ status: event.target.value, page: null })}
                    value={searchParams.get("status") ?? "ALL"}
                  >
                    <option value="ALL">Tất cả</option>
                    {Object.entries(assignmentStatusLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Loại phân công">
                  <select
                    onChange={(event) =>
                      updateParams({ assignmentType: event.target.value, page: null })
                    }
                    value={searchParams.get("assignmentType") ?? "ALL"}
                  >
                    <option value="ALL">Tất cả</option>
                    {Object.entries(assignmentTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </FormField>
              </>
            ) : null}
            {tab === "users" ? (
              <>
                <FormField label="Vai trò">
                  <select
                    onChange={(event) => updateParams({ role: event.target.value, page: null })}
                    value={searchParams.get("role") ?? "ALL"}
                  >
                    <option value="ALL">Tất cả</option>
                    {Object.entries(roleLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Trạng thái">
                  <select
                    onChange={(event) => updateParams({ status: event.target.value, page: null })}
                    value={searchParams.get("status") ?? "ALL"}
                  >
                    <option value="ALL">Tất cả</option>
                    <option value="ACTIVE">Hoạt động</option>
                    <option value="INACTIVE">Vô hiệu hóa</option>
                  </select>
                </FormField>
              </>
            ) : null}
            {tab === "staff" || tab === "assignments" ? (
              <FormField label="Cơ sở">
                <select
                  onChange={(event) => updateParams({ branchId: event.target.value, page: null })}
                  value={searchParams.get("branchId") ?? ""}
                >
                  <option value="">Tất cả cơ sở</option>
                  {branchOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormField>
            ) : null}
            {tab === "staff" || tab === "users" ? (
              <FormField label="Liên kết tài khoản">
                <select
                  onChange={(event) => updateParams({ account: event.target.value, page: null })}
                  value={searchParams.get("account") ?? "ALL"}
                >
                  <option value="ALL">Tất cả</option>
                  <option value="LINKED">Đã liên kết</option>
                  <option value="UNLINKED">Chưa liên kết</option>
                </select>
              </FormField>
            ) : null}
            <FormField label="Số dòng">
              <select
                onChange={(event) => updateParams({ pageSize: event.target.value, page: null })}
                value={searchParams.get("pageSize") ?? "20"}
              >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </FormField>
          </div>
        </div>

        {message ? (
          <p
            aria-live="polite"
            className="mx-5 mt-5 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700"
          >
            {message}
          </p>
        ) : null}
        {error ? (
          <div className="m-5 rounded-xl bg-rose-50 p-4 text-sm text-rose-700" role="alert">
            <p>{error}</p>
            <button
              className="mt-2 font-semibold underline"
              onClick={() => setRefreshKey((value) => value + 1)}
              type="button"
            >
              Thử lại
            </button>
          </div>
        ) : null}

        <div className="p-5">
          <TableShell empty={!data || data.items.length === 0} loading={loading}>
            {tab === "branches" ? (
              <BranchRows items={(data?.items ?? []) as readonly AdminBranchDto[]} />
            ) : tab === "staff" ? (
              <StaffRows items={(data?.items ?? []) as readonly AdminStaffDto[]} />
            ) : tab === "assignments" ? (
              <AssignmentRows items={(data?.items ?? []) as readonly AdminAssignmentDto[]} />
            ) : (
              <UserRows items={(data?.items ?? []) as readonly AdminUserDto[]} />
            )}
          </TableShell>
        </div>

        {data && data.total > 0 ? (
          <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4 text-sm">
            <p className="text-slate-500">
              Trang {data.page}/{totalPages}
            </p>
            <div className="flex gap-2">
              <button
                className="rounded-lg border border-slate-200 px-3 py-2 font-semibold disabled:opacity-40"
                disabled={data.page <= 1}
                onClick={() => updateParams({ page: String(data.page - 1) })}
                type="button"
              >
                Trước
              </button>
              <button
                className="rounded-lg border border-slate-200 px-3 py-2 font-semibold disabled:opacity-40"
                disabled={data.page >= totalPages}
                onClick={() => updateParams({ page: String(data.page + 1) })}
                type="button"
              >
                Sau
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {drawerOpen ? (
        <Drawer onClose={() => setDrawerOpen(false)} title={title}>
          <CreateForm branches={branchOptions} onSaved={saved} staff={staffOptions} tab={tab} />
        </Drawer>
      ) : null}
    </div>
  );
}
