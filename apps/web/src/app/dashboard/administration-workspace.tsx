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
type EditorState =
  | Readonly<{ kind: "branch-edit" | "branch-toggle"; item: AdminBranchDto }>
  | Readonly<{ kind: "staff-edit" | "staff-archive"; item: AdminStaffDto }>
  | Readonly<{
      kind: "assignment-end" | "assignment-transfer" | "assignment-cancel";
      item: AdminAssignmentDto;
    }>
  | Readonly<{ kind: "user-edit" | "user-toggle"; item: AdminUserDto }>;

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

function money(value: string): string {
  return new Intl.NumberFormat("vi-VN").format(BigInt(value));
}

function displayBusinessDate(value: string | null): string {
  if (!value) return "Chưa cập nhật";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

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
      className={`inline-flex max-w-full whitespace-normal break-words rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset [overflow-wrap:anywhere] ${tones[tone]}`}
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
        className="absolute inset-y-0 right-0 flex w-full max-w-xl min-w-0 flex-col overflow-hidden bg-white shadow-2xl"
        ref={panelRef}
        role="dialog"
      >
        <div className="z-10 flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
              Quản trị nền tảng
            </p>
            <h2
              className="mt-1 break-words text-xl font-semibold [overflow-wrap:anywhere]"
              id="administration-drawer-title"
            >
              {title}
            </h2>
          </div>
          <button
            className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            Đóng
          </button>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 [overflow-wrap:anywhere] sm:p-6">
          {children}
        </div>
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

function ActionButton({
  children,
  onClick,
  tone = "neutral",
}: Readonly<{
  children: ReactNode;
  onClick: () => void;
  tone?: "neutral" | "warning";
}>) {
  return (
    <button
      className={`max-w-full whitespace-normal break-words rounded-lg border px-3 py-2 text-xs font-semibold [overflow-wrap:anywhere] ${
        tone === "warning"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-slate-200 text-slate-700 hover:bg-slate-50"
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
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
  const [staffCategory, setStaffCategory] = useState<
    "OFFICIAL" | "PROBATION" | "CONTRACTOR" | "INTERN"
  >("PROBATION");
  const [staffJoinedDate, setStaffJoinedDate] = useState(businessDate());
  const [staffOfficialDate, setStaffOfficialDate] = useState("");

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
          baseSalaryAmount: field(form, "baseSalaryAmount"),
          joinedDate: field(form, "joinedDate"),
          officialDate: field(form, "officialDate") || null,
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
          canManagePayroll: form.get("canManagePayroll") === "on",
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
            <FormField label="Lương cơ bản (VND)">
              <input
                defaultValue="0"
                inputMode="numeric"
                min="0"
                name="baseSalaryAmount"
                required
                step="1"
                type="number"
              />
            </FormField>
            <FormField label="Ngày gia nhập công ty">
              <input
                name="joinedDate"
                onChange={(event) => setStaffJoinedDate(event.target.value)}
                required
                type="date"
                value={staffJoinedDate}
              />
            </FormField>
            <FormField label="Ngày lên chính thức">
              <input
                min={staffJoinedDate}
                name="officialDate"
                onChange={(event) => setStaffOfficialDate(event.target.value)}
                required={staffCategory === "OFFICIAL"}
                type="date"
                value={staffOfficialDate}
              />
            </FormField>
          </div>
          <FormField label="Loại hình nhân sự">
            <select
              name="employmentCategory"
              onChange={(event) =>
                setStaffCategory(
                  event.target.value as "OFFICIAL" | "PROBATION" | "CONTRACTOR" | "INTERN",
                )
              }
              value={staffCategory}
            >
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
          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-medium">
            <input name="canManagePayroll" type="checkbox" />
            Được phép quản lý Payroll toàn công ty
          </label>
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

function editorTitle(editor: EditorState): string {
  switch (editor.kind) {
    case "branch-edit":
      return "Sửa thông tin cơ sở";
    case "branch-toggle":
      return editor.item.isActive ? "Ngừng hoạt động cơ sở" : "Kích hoạt lại cơ sở";
    case "staff-edit":
      return "Sửa hồ sơ nhân viên";
    case "staff-archive":
      return "Lưu trữ hồ sơ nhân viên";
    case "assignment-end":
      return "Kết thúc phân công";
    case "assignment-transfer":
      return "Chuyển nhân viên sang cơ sở khác";
    case "assignment-cancel":
      return "Hủy phân công sắp hiệu lực";
    case "user-edit":
      return "Sửa vai trò và liên kết";
    case "user-toggle":
      return editor.item.active ? "Vô hiệu hóa tài khoản" : "Kích hoạt lại tài khoản";
  }
}

function MutationForm({
  branches,
  editor,
  onReload,
  onSaved,
  staff,
}: Readonly<{
  branches: readonly Option[];
  editor: EditorState;
  onReload: () => void;
  onSaved: (message: string) => void;
  staff: readonly Option[];
}>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const editableStaff = editor.kind === "staff-edit" ? editor.item : null;
  const [staffCategory, setStaffCategory] = useState(editableStaff?.employmentCategory);
  const [staffJoinedDate, setStaffJoinedDate] = useState(editableStaff?.joinedDate ?? "");
  const [staffOfficialDate, setStaffOfficialDate] = useState(editableStaff?.officialDate ?? "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = field(form, "reason");
    let request: Readonly<{
      path: string;
      method: "PATCH" | "POST";
      body: Readonly<Record<string, unknown>>;
      success: string;
    }>;

    switch (editor.kind) {
      case "branch-edit":
        request = {
          path: `/api/branches/${editor.item.id}`,
          method: "PATCH",
          body: {
            name: field(form, "name"),
            address: field(form, "address"),
            version: editor.item.version,
            reason,
          },
          success: "Đã cập nhật cơ sở.",
        };
        break;
      case "branch-toggle":
        request = {
          path: `/api/branches/${editor.item.id}`,
          method: "PATCH",
          body: { isActive: !editor.item.isActive, version: editor.item.version, reason },
          success: editor.item.isActive ? "Đã ngừng hoạt động cơ sở." : "Đã kích hoạt cơ sở.",
        };
        break;
      case "staff-edit": {
        const employmentCategory = field(form, "employmentCategory");
        const employmentStatus = field(form, "employmentStatus");
        const changesEmployment =
          employmentCategory !== editor.item.employmentCategory ||
          employmentStatus !== editor.item.employmentStatus;
        request = {
          path: `/api/staff/${editor.item.id}`,
          method: "PATCH",
          body: {
            fullName: field(form, "fullName"),
            streamingAlias: field(form, "streamingAlias") || null,
            email: field(form, "email") || undefined,
            phone: field(form, "phone") || undefined,
            jobTitle: field(form, "jobTitle"),
            baseSalaryAmount: field(form, "baseSalaryAmount"),
            joinedDate: field(form, "joinedDate") || null,
            officialDate: field(form, "officialDate") || null,
            employmentCategory: changesEmployment ? employmentCategory : undefined,
            employmentStatus: changesEmployment ? employmentStatus : undefined,
            effectiveFrom: changesEmployment ? field(form, "effectiveFrom") : undefined,
            version: editor.item.version,
            reason,
          },
          success: "Đã cập nhật hồ sơ nhân viên.",
        };
        break;
      }
      case "staff-archive":
        request = {
          path: `/api/staff/${editor.item.id}/archive`,
          method: "POST",
          body: { version: editor.item.version, reason },
          success: "Đã lưu trữ hồ sơ nhân viên.",
        };
        break;
      case "assignment-end":
        request = {
          path: `/api/assignments/${editor.item.id}`,
          method: "PATCH",
          body: {
            effectiveTo: field(form, "effectiveTo"),
            version: editor.item.version,
            reason,
          },
          success: "Đã kết thúc phân công.",
        };
        break;
      case "assignment-transfer":
        request = {
          path: `/api/assignments/${editor.item.id}/transfer`,
          method: "POST",
          body: {
            targetBranchId: field(form, "targetBranchId"),
            effectiveFrom: field(form, "effectiveFrom"),
            version: editor.item.version,
            reason,
          },
          success: "Đã chuyển cơ sở và lưu lịch sử phân công.",
        };
        break;
      case "assignment-cancel":
        request = {
          path: `/api/assignments/${editor.item.id}/cancel`,
          method: "POST",
          body: { version: editor.item.version, reason },
          success: "Đã hủy phân công sắp hiệu lực.",
        };
        break;
      case "user-edit":
        request = {
          path: `/api/users/${editor.item.id}`,
          method: "PATCH",
          body: {
            role: field(form, "role"),
            canManagePayroll: form.get("canManagePayroll") === "on",
            staffId: field(form, "staffId") || null,
            version: editor.item.version,
            reason,
          },
          success: "Đã cập nhật tài khoản.",
        };
        break;
      case "user-toggle":
        request = {
          path: `/api/users/${editor.item.id}`,
          method: "PATCH",
          body: { active: !editor.item.active, version: editor.item.version, reason },
          success: editor.item.active ? "Đã vô hiệu hóa tài khoản." : "Đã kích hoạt tài khoản.",
        };
        break;
    }

    setPending(true);
    setError(null);
    setConflict(false);
    try {
      const response = await fetch(request.path, {
        method: request.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        setConflict(response.status === 409);
        throw new Error(apiError(payload));
      }
      onSaved(request.success);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể lưu dữ liệu.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      {editor.kind === "branch-edit" ? (
        <>
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            Mã cơ sở <strong>{editor.item.code}</strong> không đổi sau khi tạo.
          </div>
          <FormField label="Tên cơ sở">
            <input defaultValue={editor.item.name} name="name" required />
          </FormField>
          <FormField label="Địa chỉ">
            <textarea defaultValue={editor.item.address ?? ""} name="address" rows={3} />
          </FormField>
        </>
      ) : null}

      {editor.kind === "branch-toggle" ? (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
          {editor.item.isActive
            ? `Cơ sở ${editor.item.code} chỉ có thể ngừng khi không còn phân công hiệu lực. Dữ liệu lịch sử vẫn được giữ nguyên.`
            : `Cơ sở ${editor.item.code} sẽ xuất hiện lại trong các lựa chọn phân công mới.`}
        </p>
      ) : null}

      {editor.kind === "staff-edit" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Họ và tên">
              <input defaultValue={editor.item.fullName} name="fullName" required />
            </FormField>
            <FormField label="ACC / alias Live">
              <input defaultValue={editor.item.streamingAlias ?? ""} name="streamingAlias" />
            </FormField>
            <FormField label="Vị trí công việc">
              <input defaultValue={editor.item.jobTitle} name="jobTitle" required />
            </FormField>
            <FormField label="Email">
              <input defaultValue={editor.item.email ?? ""} name="email" type="email" />
            </FormField>
            <FormField label="Số điện thoại">
              <input defaultValue={editor.item.phone ?? ""} name="phone" />
            </FormField>
            <FormField label="Lương cơ bản (VND)">
              <input
                defaultValue={editor.item.baseSalaryAmount}
                inputMode="numeric"
                min="0"
                name="baseSalaryAmount"
                required
                step="1"
                type="number"
              />
            </FormField>
            <FormField label="Ngày gia nhập công ty">
              <input
                name="joinedDate"
                onChange={(event) => setStaffJoinedDate(event.target.value)}
                type="date"
                value={staffJoinedDate}
              />
            </FormField>
            <FormField label="Ngày lên chính thức">
              <input
                min={staffJoinedDate || undefined}
                name="officialDate"
                onChange={(event) => setStaffOfficialDate(event.target.value)}
                type="date"
                value={staffOfficialDate}
              />
            </FormField>
            <FormField label="Loại hình nhân sự">
              <select
                name="employmentCategory"
                onChange={(event) =>
                  setStaffCategory(
                    event.target.value as "OFFICIAL" | "PROBATION" | "CONTRACTOR" | "INTERN",
                  )
                }
                value={staffCategory}
              >
                {Object.entries(employmentCategoryLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Trạng thái việc làm">
              <select defaultValue={editor.item.employmentStatus} name="employmentStatus">
                {Object.entries(employmentStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Ngày hiệu lực nếu đổi loại/trạng thái">
              <input
                defaultValue={businessDate()}
                max={businessDate()}
                name="effectiveFrom"
                type="date"
              />
            </FormField>
          </div>
          <p className="text-sm text-slate-500">
            Thay đổi loại hoặc trạng thái sẽ tạo lịch sử hiệu lực; không ghi đè lịch sử cũ.
          </p>
        </>
      ) : null}

      {editor.kind === "staff-archive" ? (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
          Hồ sơ {editor.item.staffCode} chỉ được lưu trữ sau khi đã nghỉ việc, không còn phân công
          hiệu lực và không còn tài khoản hoạt động. Đây không phải thao tác xóa.
        </p>
      ) : null}

      {editor.kind === "assignment-end" ? (
        <>
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            {editor.item.staff.fullName} tại {editor.item.branch.code}, bắt đầu{" "}
            {editor.item.effectiveFrom}.
          </p>
          <FormField label="Ngày kết thúc (exclusive)">
            <input
              defaultValue={editor.item.effectiveTo ?? businessDate()}
              min={editor.item.effectiveFrom}
              name="effectiveTo"
              required
              type="date"
            />
          </FormField>
        </>
      ) : null}

      {editor.kind === "assignment-transfer" ? (
        <>
          <p className="rounded-xl bg-sky-50 p-3 text-sm text-sky-800">
            Hệ thống sẽ đóng phân công tại {editor.item.branch.code} và tạo phân công mới trong cùng
            transaction.
          </p>
          <FormField label="Cơ sở nhận">
            <select name="targetBranchId" required>
              <option value="">Chọn cơ sở khác</option>
              {branches
                .filter(({ id }) => id !== editor.item.branch.id)
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
            </select>
          </FormField>
          <FormField label="Ngày chuyển">
            <input
              defaultValue={businessDate()}
              min={editor.item.effectiveFrom}
              name="effectiveFrom"
              required
              type="date"
            />
          </FormField>
        </>
      ) : null}

      {editor.kind === "assignment-cancel" ? (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
          Phân công bắt đầu ngày {editor.item.effectiveFrom} sẽ được đánh dấu đã hủy và vẫn còn
          trong lịch sử.
        </p>
      ) : null}

      {editor.kind === "user-edit" ? (
        <>
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            {editor.item.username ?? editor.item.email} · {editor.item.email}
          </p>
          <FormField label="Vai trò">
            <select defaultValue={editor.item.role} name="role">
              {Object.entries(roleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Liên kết nhân viên">
            <select defaultValue={editor.item.staff?.id ?? ""} name="staffId">
              <option value="">Không liên kết</option>
              {staff.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-medium">
            <input
              defaultChecked={editor.item.canManagePayroll}
              name="canManagePayroll"
              type="checkbox"
            />
            Được phép quản lý Payroll toàn công ty
          </label>
        </>
      ) : null}

      {editor.kind === "user-toggle" ? (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
          {editor.item.active
            ? "Tài khoản sẽ bị khóa và toàn bộ phiên đăng nhập hiện tại bị thu hồi. Không thể tự khóa hoặc khóa GM hoạt động cuối cùng."
            : "Tài khoản sẽ được phép đăng nhập lại với vai trò hiện tại."}
        </p>
      ) : null}

      <FormField label="Lý do thao tác">
        <textarea name="reason" required rows={3} />
      </FormField>
      {error ? (
        <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">
          <p>{error}</p>
          {conflict ? (
            <button className="mt-2 font-semibold underline" onClick={onReload} type="button">
              Tải dữ liệu mới nhất
            </button>
          ) : null}
        </div>
      ) : null}
      <Button disabled={pending}>{pending ? "Đang lưu…" : "Xác nhận và lưu"}</Button>
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

function BranchRows({
  items,
  onAction,
}: Readonly<{
  items: readonly AdminBranchDto[];
  onAction: (editor: EditorState) => void;
}>) {
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
              <th className="px-4 py-3">Thao tác</th>
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
                <td className="px-4 py-4">
                  <div className="flex min-w-max gap-2">
                    <ActionButton onClick={() => onAction({ kind: "branch-edit", item })}>
                      Sửa
                    </ActionButton>
                    <ActionButton
                      onClick={() => onAction({ kind: "branch-toggle", item })}
                      tone={item.isActive ? "warning" : "neutral"}
                    >
                      {item.isActive ? "Ngừng" : "Kích hoạt"}
                    </ActionButton>
                  </div>
                </td>
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
            <div className="mt-4 flex gap-2">
              <ActionButton onClick={() => onAction({ kind: "branch-edit", item })}>
                Sửa
              </ActionButton>
              <ActionButton
                onClick={() => onAction({ kind: "branch-toggle", item })}
                tone={item.isActive ? "warning" : "neutral"}
              >
                {item.isActive ? "Ngừng" : "Kích hoạt"}
              </ActionButton>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function StaffRows({
  items,
  onAction,
}: Readonly<{
  items: readonly AdminStaffDto[];
  onAction: (editor: EditorState) => void;
}>) {
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
              <th className="px-4 py-3">Thao tác</th>
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
                  <p className="text-xs text-slate-500">
                    Lương cơ bản: {money(item.baseSalaryAmount)} ₫
                  </p>
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
                  <p className="mt-2 text-xs text-slate-500">
                    Gia nhập: {displayBusinessDate(item.joinedDate)}
                  </p>
                  <p className="text-xs text-slate-500">
                    Chính thức: {displayBusinessDate(item.officialDate)}
                  </p>
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
                <td className="px-4 py-4">
                  <div className="flex min-w-max gap-2">
                    <ActionButton onClick={() => onAction({ kind: "staff-edit", item })}>
                      Sửa
                    </ActionButton>
                    {item.employmentStatus === "TERMINATED" ? (
                      <ActionButton
                        onClick={() => onAction({ kind: "staff-archive", item })}
                        tone="warning"
                      >
                        Lưu trữ
                      </ActionButton>
                    ) : null}
                  </div>
                </td>
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
                <p className="text-sm text-slate-500">
                  Lương cơ bản: {money(item.baseSalaryAmount)} ₫
                </p>
                <p className="text-sm text-slate-500">
                  Gia nhập: {displayBusinessDate(item.joinedDate)}
                </p>
                <p className="text-sm text-slate-500">
                  Chính thức: {displayBusinessDate(item.officialDate)}
                </p>
              </div>
              <Badge tone={item.employmentStatus === "ACTIVE" ? "green" : "slate"}>
                {employmentStatusLabels[item.employmentStatus]}
              </Badge>
            </div>
            <p className="mt-3 text-sm">
              {item.currentAssignments.map(({ branchCode }) => branchCode).join(", ") ||
                "Chưa phân công"}
            </p>
            <div className="mt-4 flex gap-2">
              <ActionButton onClick={() => onAction({ kind: "staff-edit", item })}>
                Sửa
              </ActionButton>
              {item.employmentStatus === "TERMINATED" ? (
                <ActionButton
                  onClick={() => onAction({ kind: "staff-archive", item })}
                  tone="warning"
                >
                  Lưu trữ
                </ActionButton>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function AssignmentRows({
  items,
  onAction,
}: Readonly<{
  items: readonly AdminAssignmentDto[];
  onAction: (editor: EditorState) => void;
}>) {
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
            <th className="px-4 py-3">Thao tác</th>
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
              <td className="px-4 py-4">
                <div className="flex min-w-max gap-2">
                  {item.status === "CURRENT" ? (
                    <>
                      <ActionButton onClick={() => onAction({ kind: "assignment-end", item })}>
                        Kết thúc
                      </ActionButton>
                      <ActionButton onClick={() => onAction({ kind: "assignment-transfer", item })}>
                        Chuyển cơ sở
                      </ActionButton>
                    </>
                  ) : null}
                  {item.status === "UPCOMING" ? (
                    <ActionButton
                      onClick={() => onAction({ kind: "assignment-cancel", item })}
                      tone="warning"
                    >
                      Hủy
                    </ActionButton>
                  ) : null}
                  {item.status === "ENDED" || item.status === "CANCELLED" ? "—" : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRows({
  items,
  onAction,
}: Readonly<{
  items: readonly AdminUserDto[];
  onAction: (editor: EditorState) => void;
}>) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Tài khoản</th>
            <th className="px-4 py-3">Vai trò</th>
            <th className="px-4 py-3">Nhân viên liên kết</th>
            <th className="px-4 py-3">Payroll</th>
            <th className="px-4 py-3">Trạng thái</th>
            <th className="px-4 py-3">Mật khẩu tạm</th>
            <th className="px-4 py-3">Thao tác</th>
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
                {item.role === "GENERAL_MANAGER" || item.canManagePayroll
                  ? "Được quản lý"
                  : "Không"}
              </td>
              <td className="px-4 py-4">
                <Badge tone={item.active ? "green" : "slate"}>
                  {item.active ? "Hoạt động" : "Vô hiệu hóa"}
                </Badge>
              </td>
              <td className="px-4 py-4">{item.mustChangePassword ? "Bắt buộc đổi" : "Đã đổi"}</td>
              <td className="px-4 py-4">
                <div className="flex min-w-max gap-2">
                  <ActionButton onClick={() => onAction({ kind: "user-edit", item })}>
                    Sửa
                  </ActionButton>
                  <ActionButton
                    onClick={() => onAction({ kind: "user-toggle", item })}
                    tone={item.active ? "warning" : "neutral"}
                  >
                    {item.active ? "Vô hiệu hóa" : "Kích hoạt"}
                  </ActionButton>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdministrationWorkspace({
  activeBranchOptions,
  assignableStaffOptions,
  branchOptions,
  staffOptions,
}: Readonly<{
  activeBranchOptions: readonly Option[];
  assignableStaffOptions: readonly Option[];
  branchOptions: readonly Option[];
  staffOptions: readonly Option[];
}>) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = activeTab(searchParams.get("tab"));
  const queryString = searchParams.toString();
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
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
    setEditor(null);
    router.push(`${pathname}?tab=${next}`, { scroll: false });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateParams({ search: field(new FormData(event.currentTarget), "search"), page: null });
  }

  function saved(successMessage: string) {
    setDrawerOpen(false);
    setEditor(null);
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
              <BranchRows
                items={(data?.items ?? []) as readonly AdminBranchDto[]}
                onAction={setEditor}
              />
            ) : tab === "staff" ? (
              <StaffRows
                items={(data?.items ?? []) as readonly AdminStaffDto[]}
                onAction={setEditor}
              />
            ) : tab === "assignments" ? (
              <AssignmentRows
                items={(data?.items ?? []) as readonly AdminAssignmentDto[]}
                onAction={setEditor}
              />
            ) : (
              <UserRows
                items={(data?.items ?? []) as readonly AdminUserDto[]}
                onAction={setEditor}
              />
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
          <CreateForm
            branches={tab === "assignments" ? activeBranchOptions : branchOptions}
            onSaved={saved}
            staff={tab === "assignments" ? assignableStaffOptions : staffOptions}
            tab={tab}
          />
        </Drawer>
      ) : null}
      {editor ? (
        <Drawer onClose={() => setEditor(null)} title={editorTitle(editor)}>
          <MutationForm
            branches={activeBranchOptions}
            editor={editor}
            key={`${editor.kind}-${editor.item.id}-${editor.item.version}`}
            onReload={() => {
              setEditor(null);
              setRefreshKey((value) => value + 1);
            }}
            onSaved={saved}
            staff={staffOptions}
          />
        </Drawer>
      ) : null}
    </div>
  );
}
