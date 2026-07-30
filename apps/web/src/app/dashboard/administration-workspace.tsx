"use client";

import type {
  AdminAssignmentDto,
  AdminBranchDto,
  AdminPageDto,
  AdminStaffDto,
  AdminUserDto,
  StaffWorkScheduleDto,
} from "@ald/contracts";
import { Button } from "@ald/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  uploadStaffPrivateDocument,
  type StaffPrivateDocumentKind,
} from "./private-document-upload";
import {
  apiErrorMessage,
  staffProfileFieldErrorsFrom,
} from "./staff-profile-field-errors";
import {
  StaffProfileFields,
  type StaffProfileEditorValues,
  type StaffProfileFieldErrors,
} from "./staff-profile-fields";
import type { StaffWorkspaceCapabilities } from "./staff-workspace-capabilities";

type Option = Readonly<{ id: string; label: string }>;
type Tab = "branches" | "staff" | "assignments" | "users";
type PageData =
  | AdminPageDto<AdminBranchDto>
  | AdminPageDto<AdminStaffDto>
  | AdminPageDto<AdminAssignmentDto>
  | AdminPageDto<AdminUserDto>;
type EditorState =
  | Readonly<{ kind: "branch-edit" | "branch-toggle"; item: AdminBranchDto }>
  | Readonly<{
      kind: "staff-edit" | "staff-terminate" | "staff-archive";
      item: AdminStaffDto;
    }>
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

function privateDocumentStatus(value: string | null): string {
  if (value === "READY") return "Đã tải lên";
  if (value === "PENDING_UPLOAD") return "Chờ tải lên";
  if (value === "REJECTED") return "Tải lên thất bại";
  if (value === "SUPERSEDED") return "Đã được thay thế";
  return "Chưa có";
}

type IdentityDocument = AdminStaffDto["identityDocuments"][number];
type BankQrDocument = NonNullable<AdminStaffDto["bankQrDocument"]>;
type ProfileDocument =
  | Readonly<{ kind: "IDENTITY"; title: string; document: IdentityDocument }>
  | Readonly<{ kind: "BANK_QR"; title: string; document: BankQrDocument }>;
type DocumentPreview = Readonly<{
  source: ProfileDocument;
  phase: "LOADING" | "READY" | "FAILED";
  url: string | null;
  expiresInSeconds: number | null;
  error: string | null;
}>;

function minutesAsTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function timeAsMinutes(value: string): number | null {
  const match = /^(\d{2}):([0-5]\d)$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 ? hours * 60 + minutes : null;
}

function fileSize(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return value;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} KB`;
  }
  return `${(bytes / 1024 / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} MB`;
}

function optionalText(value: string | null | undefined): string {
  return value?.trim() || "Chưa cập nhật";
}

function activeTab(value: string | null): Tab {
  return tabs.some(({ id }) => id === value) ? (value as Tab) : "branches";
}

function apiError(payload: unknown): string {
  return apiErrorMessage(payload, "Không thể xử lý yêu cầu.");
}

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function businessDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());
}

function emptyAdminStaffProfileValues(): StaffProfileEditorValues {
  return {
    staffCode: "",
    attendanceMachineCode: "",
    fullName: "",
    streamingAlias: "",
    tiktokChannelId: "",
    email: "",
    phone: "",
    dateOfBirth: "",
    citizenIdNumber: "",
    bankAccountNumber: "",
    bankName: "",
    permanentAddress: "",
    temporaryAddress: "",
    facebookUrl: "",
    university: "",
    jobTitle: "Nhân viên Live",
    joinedDate: businessDate(),
    officialDate: "",
    employmentCategory: "PROBATION",
    employmentStatus: "ACTIVE",
    effectiveFrom: businessDate(),
    baseSalaryAmount: "0",
  };
}

function adminStaffProfileValues(staff: AdminStaffDto | null): StaffProfileEditorValues {
  if (!staff) return emptyAdminStaffProfileValues();
  return {
    staffCode: staff.staffCode,
    attendanceMachineCode: "",
    fullName: staff.fullName,
    streamingAlias: staff.streamingAlias ?? "",
    tiktokChannelId: staff.tiktokChannelId ?? "",
    email: staff.email ?? "",
    phone: staff.phone ?? "",
    dateOfBirth: staff.dateOfBirth ?? "",
    citizenIdNumber: staff.citizenIdNumber ?? "",
    bankAccountNumber: staff.bankAccountNumber ?? "",
    bankName: staff.bankName ?? "",
    permanentAddress: staff.permanentAddress ?? "",
    temporaryAddress: staff.temporaryAddress ?? "",
    facebookUrl: staff.facebookUrl ?? "",
    university: staff.university ?? "",
    jobTitle: staff.jobTitle,
    joinedDate: staff.joinedDate ?? "",
    officialDate: staff.officialDate ?? "",
    employmentCategory: staff.employmentCategory,
    employmentStatus: staff.employmentStatus,
    effectiveFrom: businessDate(),
    baseSalaryAmount: staff.baseSalaryAmount,
  };
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
  wide = false,
}: Readonly<{ children: ReactNode; onClose: () => void; title: string; wide?: boolean }>) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
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
      previousFocus?.focus();
    };
  }, []);

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
        className={`absolute inset-y-0 right-0 flex w-full min-w-0 flex-col overflow-hidden bg-white shadow-2xl ${
          wide ? "max-w-5xl" : "max-w-xl"
        }`}
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
  capabilities,
  onSaved,
  staff,
  tab,
}: Readonly<{
  branches: readonly Option[];
  capabilities: StaffWorkspaceCapabilities;
  onSaved: (message: string) => void;
  staff: readonly Option[];
  tab: Tab;
  }>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staffFieldErrors, setStaffFieldErrors] = useState<StaffProfileFieldErrors>({});
  const [staffProfile, setStaffProfile] = useState<StaffProfileEditorValues>(
    emptyAdminStaffProfileValues,
  );

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
        },
      },
      staff: {
        path: "/api/staff",
        success: "Đã tạo nhân viên.",
        body: {
          staffCode: field(form, "staffCode"),
          fullName: field(form, "fullName"),
          streamingAlias: field(form, "streamingAlias") || null,
          tiktokChannelId: field(form, "tiktokChannelId") || null,
          email: field(form, "email") || null,
          phone: field(form, "phone") || null,
          dateOfBirth: field(form, "dateOfBirth") || null,
          citizenIdNumber: field(form, "citizenIdNumber") || null,
          bankAccountNumber: field(form, "bankAccountNumber") || null,
          bankName: field(form, "bankName") || null,
          permanentAddress: field(form, "permanentAddress") || null,
          temporaryAddress: field(form, "temporaryAddress") || null,
          facebookUrl: field(form, "facebookUrl") || null,
          university: field(form, "university") || null,
          jobTitle: field(form, "jobTitle"),
          baseSalaryAmount: field(form, "baseSalaryAmount"),
          joinedDate: field(form, "joinedDate"),
          officialDate: field(form, "officialDate") || null,
          employmentCategory: field(form, "employmentCategory"),
        },
      },
      assignments: {
        path: "/api/assignments",
        success: "Đã tạo phân công.",
        body: {
          staffId: field(form, "staffId"),
          branchId: field(form, "branchId"),
          assignmentType: field(form, "assignmentType"),
          attendanceMachineCode: field(form, "attendanceMachineCode") || null,
          effectiveFrom: field(form, "effectiveFrom"),
          effectiveTo: field(form, "effectiveTo") || null,
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
        },
      },
    } as const;
    const configuration = configurations[tab];
    setPending(true);
    setError(null);
    setStaffFieldErrors({});
    try {
      const response = await fetch(configuration.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configuration.body),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        if (tab === "staff") {
          setStaffFieldErrors(staffProfileFieldErrorsFrom(payload, response.status));
        }
        throw new Error(apiError(payload));
      }
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
        <StaffProfileFields
          capabilities={capabilities}
          errors={staffFieldErrors}
          joinedDateRequired
          onChange={(fieldName, value) => {
            setError(null);
            setStaffFieldErrors((current) => ({ ...current, [fieldName]: undefined }));
            setStaffProfile(
              (current) => ({ ...current, [fieldName]: value }) as StaffProfileEditorValues,
            );
          }}
          officialDateRequired
          showAttendanceMachineCode={false}
          today={businessDate()}
          values={staffProfile}
        />
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
          <FormField label="Mã máy chấm công (bắt buộc với nhân viên)">
            <input name="attendanceMachineCode" />
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
    case "staff-terminate":
      return editor.item.employmentStatus === "TERMINATED"
        ? "Bổ sung ngày nghỉ việc"
        : "Cho nhân viên nghỉ việc";
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
  capabilities,
  editor,
  onReload,
  onSaved,
  staff,
}: Readonly<{
  branches: readonly Option[];
  capabilities: StaffWorkspaceCapabilities;
  editor: EditorState;
  onReload: () => void;
  onSaved: (message: string) => void;
  staff: readonly Option[];
}>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const editableStaff = editor.kind === "staff-edit" ? editor.item : null;
  const [staffFieldErrors, setStaffFieldErrors] = useState<StaffProfileFieldErrors>({});
  const [staffProfile, setStaffProfile] = useState<StaffProfileEditorValues>(() =>
    adminStaffProfileValues(editableStaff),
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
          },
          success: "Đã cập nhật cơ sở.",
        };
        break;
      case "branch-toggle":
        request = {
          path: `/api/branches/${editor.item.id}`,
          method: "PATCH",
          body: { isActive: !editor.item.isActive, version: editor.item.version },
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
            staffCode: field(form, "staffCode"),
            fullName: field(form, "fullName"),
            streamingAlias: field(form, "streamingAlias") || null,
            tiktokChannelId: field(form, "tiktokChannelId") || null,
            email: field(form, "email") || null,
            phone: field(form, "phone") || null,
            dateOfBirth: field(form, "dateOfBirth") || null,
            citizenIdNumber: field(form, "citizenIdNumber") || null,
            bankAccountNumber: field(form, "bankAccountNumber") || null,
            bankName: field(form, "bankName") || null,
            permanentAddress: field(form, "permanentAddress") || null,
            temporaryAddress: field(form, "temporaryAddress") || null,
            facebookUrl: field(form, "facebookUrl") || null,
            university: field(form, "university") || null,
            jobTitle: field(form, "jobTitle"),
            baseSalaryAmount: field(form, "baseSalaryAmount"),
            joinedDate: field(form, "joinedDate") || null,
            officialDate: field(form, "officialDate") || null,
            employmentCategory: changesEmployment ? employmentCategory : undefined,
            employmentStatus: changesEmployment ? employmentStatus : undefined,
            effectiveFrom: changesEmployment ? field(form, "effectiveFrom") : undefined,
            version: editor.item.version,
          },
          success: "Đã cập nhật hồ sơ nhân viên.",
        };
        break;
      }
      case "staff-terminate":
        request = {
          path: `/api/staff/${editor.item.id}/terminate`,
          method: "POST",
          body: {
            terminationDate: field(form, "terminationDate"),
            version: editor.item.version,
          },
          success: "Đã cập nhật ngày nghỉ việc và đóng phạm vi làm việc từ tháng kế tiếp.",
        };
        break;
      case "staff-archive":
        request = {
          path: `/api/staff/${editor.item.id}/archive`,
          method: "POST",
          body: { version: editor.item.version },
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
            attendanceMachineCode: field(form, "attendanceMachineCode") || null,
            effectiveFrom: field(form, "effectiveFrom"),
            version: editor.item.version,
          },
          success: "Đã chuyển cơ sở và lưu lịch sử phân công.",
        };
        break;
      case "assignment-cancel":
        request = {
          path: `/api/assignments/${editor.item.id}/cancel`,
          method: "POST",
          body: { version: editor.item.version },
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
          },
          success: "Đã cập nhật tài khoản.",
        };
        break;
      case "user-toggle":
        request = {
          path: `/api/users/${editor.item.id}`,
          method: "PATCH",
          body: { active: !editor.item.active, version: editor.item.version },
          success: editor.item.active ? "Đã vô hiệu hóa tài khoản." : "Đã kích hoạt tài khoản.",
        };
        break;
    }

    setPending(true);
    setError(null);
    setConflict(false);
    setStaffFieldErrors({});
    try {
      const response = await fetch(request.path, {
        method: request.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        setConflict(response.status === 409);
        if (editor.kind === "staff-edit") {
          setStaffFieldErrors(staffProfileFieldErrorsFrom(payload, response.status));
        }
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
        <StaffProfileFields
          capabilities={capabilities}
          errors={staffFieldErrors}
          onChange={(fieldName, value) => {
            setError(null);
            setStaffFieldErrors((current) => ({ ...current, [fieldName]: undefined }));
            setStaffProfile(
              (current) => ({ ...current, [fieldName]: value }) as StaffProfileEditorValues,
            );
          }}
          showAttendanceMachineCode={false}
          showEmploymentControls
          today={businessDate()}
          values={staffProfile}
        />
      ) : null}

      {editor.kind === "staff-terminate" ? (
        <>
          <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
            Nhân viên vẫn được chấm công và tính lương trong toàn bộ tháng nghỉ việc. Từ tháng kế
            tiếp, nhân viên sẽ không còn xuất hiện trong Chấm công và Payroll. Tài khoản liên kết
            cũng sẽ bị vô hiệu hóa.
          </p>
          <FormField label="Ngày nghỉ việc">
            <input
              defaultValue={editor.item.terminationDate ?? businessDate()}
              max={businessDate()}
              min={editor.item.joinedDate ?? undefined}
              name="terminationDate"
              required
              type="date"
            />
          </FormField>
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

      {editor.kind === "assignment-transfer" && editor.item.assignmentType === "MEMBER" ? (
        <FormField label="Mã máy chấm công tại cơ sở mới">
          <input name="attendanceMachineCode" required />
        </FormField>
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

function ProfileSection({ children, title }: Readonly<{ children: ReactNode; title: string }>) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ProfileInfo({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-900 [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

function PrivateDocumentMetadataCard({
  document,
  onView,
  title,
}: Readonly<{
  document: IdentityDocument | BankQrDocument | null;
  onView: (source: ProfileDocument) => void;
  title: string;
}>) {
  const source: ProfileDocument | null = document
    ? "side" in document
      ? { kind: "IDENTITY", title, document }
      : { kind: "BANK_QR", title, document }
    : null;
  return (
    <article className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="font-semibold text-slate-900">{title}</h4>
        <Badge
          tone={
            document?.status === "READY"
              ? "green"
              : document?.status === "PENDING_UPLOAD"
                ? "amber"
                : document?.status === "REJECTED"
                  ? "rose"
                  : "slate"
          }
        >
          {privateDocumentStatus(document?.status ?? null)}
        </Badge>
      </div>
      {document ? (
        <dl className="mt-3 grid gap-2 text-sm">
          <div className="min-w-0">
            <dt className="text-xs text-slate-500">Tên file</dt>
            <dd
              className="break-words font-medium [overflow-wrap:anywhere]"
              title={document.originalFileName}
            >
              {document.originalFileName}
            </dd>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <dt className="text-xs text-slate-500">Dung lượng</dt>
              <dd>{fileSize(document.sizeBytes)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Loại file</dt>
              <dd className="break-words">{document.mimeType}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Phiên bản</dt>
              <dd>v{document.version}</dd>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">Tải lên</dt>
              <dd>{document.uploadedAt ? dateTime(document.uploadedAt) : "Chưa hoàn tất"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Xác minh</dt>
              <dd>{document.verifiedAt ? dateTime(document.verifiedAt) : "Chưa xác minh"}</dd>
            </div>
          </div>
        </dl>
      ) : (
        <p className="mt-3 text-sm text-slate-500">Nhân viên chưa tải tài liệu này.</p>
      )}
      {source && document?.status === "READY" ? (
        <button
          className="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100"
          onClick={() => onView(source)}
          type="button"
        >
          Xem ảnh
        </button>
      ) : null}
    </article>
  );
}

type CurrentAdminAssignment = AdminStaffDto["currentAssignments"][number];

function AssignmentMachineCodeEditor({
  assignment,
  onChanged,
  staffId,
  staffVersion,
}: Readonly<{
  assignment: CurrentAdminAssignment;
  onChanged: (message: string) => void;
  staffId: string;
  staffVersion: number;
}>) {
  const [value, setValue] = useState(assignment.attendanceMachineCode ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const attendanceMachineCode = value.trim();
    if (!attendanceMachineCode) {
      setError("Mã máy chấm công không được để trống.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/${encodeURIComponent(staffId)}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attendanceMachineCode,
          assignmentId: assignment.id,
          assignmentVersion: assignment.version,
          version: staffVersion,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiError(payload));
      onChanged(`Đã cập nhật mã máy chấm công tại ${assignment.branchName}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể cập nhật mã máy chấm công.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="mt-3 grid gap-2" onSubmit={(event) => void save(event)}>
      <label className="grid gap-1 text-xs font-medium text-slate-600">
        Mã máy chấm công
        <input
          autoCapitalize="characters"
          className="font-mono"
          maxLength={30}
          onChange={(event) => setValue(event.target.value)}
          pattern="[A-Za-z0-9_-]+"
          required
          value={value}
        />
      </label>
      <p className="text-xs text-slate-500">
        Mã được lưu dạng chuỗi nên giữ nguyên số 0 ở đầu.
      </p>
      {error ? (
        <p className="text-xs text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
      <button
        className="justify-self-start rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 disabled:opacity-50"
        disabled={pending || value.trim() === assignment.attendanceMachineCode}
        type="submit"
      >
        {pending ? "Đang lưu…" : "Lưu mã máy"}
      </button>
    </form>
  );
}

type ScheduleEditorValue = Readonly<{
  id: string | null;
  version: number | null;
  name: string;
  scheduledStart: string;
  scheduledEnd: string;
  requiredLive: string;
  effectiveFrom: string;
  effectiveTo: string;
}>;

function scheduleEditorValue(schedule?: StaffWorkScheduleDto | null): ScheduleEditorValue {
  return schedule
    ? {
        id: schedule.id,
        version: schedule.version,
        name: schedule.name,
        scheduledStart: minutesAsTime(schedule.scheduledStartMinutes),
        scheduledEnd: minutesAsTime(schedule.scheduledEndMinutes),
        requiredLive: minutesAsTime(schedule.requiredLiveMinutes),
        effectiveFrom: schedule.effectiveFrom,
        effectiveTo: schedule.effectiveTo ?? "",
      }
    : {
        id: null,
        version: null,
        name: "Ca Live",
        scheduledStart: "09:00",
        scheduledEnd: "15:00",
        requiredLive: "06:00",
        effectiveFrom: businessDate(),
        effectiveTo: "",
      };
}

function AdministrationScheduleEditor({
  currentSchedule,
  onChanged,
  staffId,
}: Readonly<{
  currentSchedule: StaffWorkScheduleDto | null;
  onChanged: (message: string) => void;
  staffId: string;
}>) {
  const [form, setForm] = useState<ScheduleEditorValue>(() => scheduleEditorValue());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof ScheduleEditorValue>(
    key: K,
    value: ScheduleEditorValue[K],
  ): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const scheduledStartMinutes = timeAsMinutes(form.scheduledStart);
    const scheduledEndMinutes = timeAsMinutes(form.scheduledEnd);
    const requiredLiveMinutes = timeAsMinutes(form.requiredLive);
    if (
      scheduledStartMinutes === null ||
      scheduledEndMinutes === null ||
      requiredLiveMinutes === null
    ) {
      setError("Giờ ca và thời lượng Live phải đúng định dạng HH:mm.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const updating = Boolean(form.id && form.version);
      const endpoint = updating
        ? `/api/staff/${encodeURIComponent(staffId)}/schedules/${encodeURIComponent(form.id!)}`
        : `/api/staff/${encodeURIComponent(staffId)}/schedules`;
      const response = await fetch(endpoint, {
        method: updating ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          scheduledStartMinutes,
          scheduledEndMinutes,
          spansNextDay: scheduledEndMinutes <= scheduledStartMinutes,
          requiredLiveMinutes,
          effectiveFrom: form.effectiveFrom,
          effectiveTo: form.effectiveTo || null,
          ...(updating ? { version: form.version } : {}),
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiError(payload));
      setForm(scheduleEditorValue());
      onChanged(updating ? "Đã cập nhật ca làm." : "Đã thêm ca làm theo ngày hiệu lực.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể lưu ca làm.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4" onSubmit={(event) => void save(event)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">{form.id ? "Sửa ca hiện tại" : "Thêm ca mới"}</h4>
        <div className="flex flex-wrap gap-2">
          {currentSchedule ? (
            <button
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"
              onClick={() => {
                setError(null);
                setForm(scheduleEditorValue(currentSchedule));
              }}
              type="button"
            >
              Sửa ca hiện tại
            </button>
          ) : null}
          <button
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"
            onClick={() => {
              setError(null);
              setForm(scheduleEditorValue());
            }}
            type="button"
          >
            Thêm ca mới
          </button>
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <FormField label="Tên ca">
          <input
            onChange={(event) => update("name", event.target.value)}
            required
            value={form.name}
          />
        </FormField>
        <FormField label="Check-in chuẩn">
          <input
            onChange={(event) => update("scheduledStart", event.target.value)}
            required
            type="time"
            value={form.scheduledStart}
          />
        </FormField>
        <FormField label="Check-out chuẩn">
          <input
            onChange={(event) => update("scheduledEnd", event.target.value)}
            required
            type="time"
            value={form.scheduledEnd}
          />
        </FormField>
        <FormField label="Live cơ bản (HH:mm)">
          <input
            inputMode="numeric"
            onChange={(event) => update("requiredLive", event.target.value)}
            pattern="\d{2}:[0-5]\d"
            placeholder="06:00"
            required
            value={form.requiredLive}
          />
        </FormField>
        <FormField label="Hiệu lực từ">
          <input
            onChange={(event) => update("effectiveFrom", event.target.value)}
            required
            type="date"
            value={form.effectiveFrom}
          />
        </FormField>
        <FormField label="Hiệu lực đến">
          <input
            onChange={(event) => update("effectiveTo", event.target.value)}
            type="date"
            value={form.effectiveTo}
          />
        </FormField>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
      <Button className="mt-3" disabled={pending}>
        {pending ? "Đang lưu…" : form.id ? "Lưu sửa ca" : "Lưu ca mới"}
      </Button>
    </form>
  );
}

function AdminPrivateDocumentUpload({
  kind,
  onChanged,
  staffId,
}: Readonly<{
  kind: StaffPrivateDocumentKind;
  onChanged: (message: string) => void;
  staffId: string;
}>) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label =
    kind === "CITIZEN_ID_FRONT"
      ? "Tải CCCD mặt trước"
      : kind === "CITIZEN_ID_BACK"
        ? "Tải CCCD mặt sau"
        : "Tải QR ngân hàng";

  async function upload(file: File): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await uploadStaffPrivateDocument({
        staffId,
        kind,
        file,
        onPhase: (phase) =>
          setStatus(
            phase === "PREPARING"
              ? "Đang chuẩn bị…"
              : phase === "UPLOADING"
                ? "Đang tải ảnh…"
                : "Đang xác minh…",
          ),
      });
      setStatus("Tải ảnh thành công.");
      onChanged("Đã cập nhật tài liệu riêng tư.");
    } catch (caught) {
      setStatus(null);
      setError(caught instanceof Error ? caught.message : "Không thể tải ảnh.");
    } finally {
      setPending(false);
    }
  }

  return (
    <label className="mt-3 grid gap-1 rounded-lg border border-dashed border-slate-300 p-3 text-xs font-semibold text-slate-700">
      {label}
      <input
        accept="image/jpeg,image/png,image/webp"
        className="block w-full text-xs"
        disabled={pending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = "";
        }}
        type="file"
      />
      {status ? <p className="mt-1 text-xs text-sky-700">{status}</p> : null}
      {error ? (
        <p className="mt-1 text-xs text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
    </label>
  );
}

function AdminStaffProfile({
  onEdit,
  onChanged,
  onManageAssignments,
  staff,
}: Readonly<{
  onEdit: () => void;
  onChanged: (message: string) => void;
  onManageAssignments: () => void;
  staff: AdminStaffDto;
}>) {
  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  const previewRequest = useRef<AbortController | null>(null);
  const front =
    staff.identityDocuments.find((document) => document.side === "CITIZEN_ID_FRONT") ?? null;
  const back =
    staff.identityDocuments.find((document) => document.side === "CITIZEN_ID_BACK") ?? null;
  const mayEdit = !staff.archivedAt && staff.employmentStatus !== "TERMINATED";

  useEffect(
    () => () => {
      previewRequest.current?.abort();
    },
    [],
  );

  async function loadPreview(source: ProfileDocument): Promise<void> {
    previewRequest.current?.abort();
    const controller = new AbortController();
    previewRequest.current = controller;
    setPreview({
      source,
      phase: "LOADING",
      url: null,
      expiresInSeconds: null,
      error: null,
    });
    try {
      const documentId = encodeURIComponent(source.document.id);
      const staffId = encodeURIComponent(staff.id);
      const path =
        source.kind === "BANK_QR"
          ? `/api/staff/${staffId}/bank-qr/${documentId}/view`
          : `/api/staff/${staffId}/identity-documents/${documentId}/view`;
      const response = await fetch(path, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (
        !response.ok ||
        typeof payload !== "object" ||
        payload === null ||
        !("data" in payload) ||
        typeof payload.data !== "object" ||
        payload.data === null ||
        !("url" in payload.data) ||
        typeof payload.data.url !== "string"
      ) {
        throw new Error(apiError(payload));
      }
      const expiresInSeconds =
        "expiresInSeconds" in payload.data && typeof payload.data.expiresInSeconds === "number"
          ? payload.data.expiresInSeconds
          : null;
      setPreview({
        source,
        phase: "READY",
        url: payload.data.url,
        expiresInSeconds,
        error: null,
      });
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setPreview({
        source,
        phase: "FAILED",
        url: null,
        expiresInSeconds: null,
        error: caught instanceof Error ? caught.message : "Không thể mở ảnh.",
      });
    }
  }

  function closePreview(): void {
    previewRequest.current?.abort();
    previewRequest.current = null;
    setPreview(null);
  }

  return (
    <div className="space-y-4" data-testid="administration-staff-profile">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-slate-50 p-4">
        <div className="min-w-0">
          <p className="break-words text-lg font-semibold">{staff.fullName}</p>
          <p className="break-words text-sm text-slate-600">
            {staff.staffCode} · {optionalText(staff.jobTitle)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            tone={
              staff.employmentStatus === "ACTIVE"
                ? "green"
                : staff.employmentStatus === "ON_LEAVE"
                  ? "amber"
                  : "slate"
            }
          >
            {employmentStatusLabels[staff.employmentStatus]}
          </Badge>
          {staff.archivedAt ? <Badge tone="slate">Đã lưu trữ</Badge> : null}
          {mayEdit ? (
            <Button onClick={onEdit} type="button">
              Chỉnh sửa
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ProfileSection title="Thông tin định danh">
          <dl className="grid gap-3 sm:grid-cols-2">
            <ProfileInfo label="Họ và tên">{staff.fullName}</ProfileInfo>
            <ProfileInfo label="Mã hồ sơ nội bộ">{staff.staffCode}</ProfileInfo>
            <ProfileInfo label="Mã máy chấm công hiện tại">
              {staff.currentAssignments
                .map(
                  (assignment) =>
                    `${assignment.branchCode}: ${assignment.attendanceMachineCode ?? "chưa có mã"}`,
                )
                .join(", ") || "Chưa phân công"}
            </ProfileInfo>
            <ProfileInfo label="Ngày sinh">{displayBusinessDate(staff.dateOfBirth)}</ProfileInfo>
            <ProfileInfo label="Số CCCD/CMND">{optionalText(staff.citizenIdNumber)}</ProfileInfo>
          </dl>
        </ProfileSection>

        <ProfileSection title="TikTok">
          <dl className="grid gap-3 sm:grid-cols-2">
            <ProfileInfo label="Tên kênh TikTok / ACC">
              {optionalText(staff.streamingAlias)}
            </ProfileInfo>
            <ProfileInfo label="ID kênh TikTok">{optionalText(staff.tiktokChannelId)}</ProfileInfo>
          </dl>
        </ProfileSection>

        <ProfileSection title="Liên hệ">
          <dl className="grid gap-3 sm:grid-cols-2">
            <ProfileInfo label="Số điện thoại">{optionalText(staff.phone)}</ProfileInfo>
            <ProfileInfo label="Email">{optionalText(staff.email)}</ProfileInfo>
            <ProfileInfo label="Facebook">
              {staff.facebookUrl &&
                (() => {
                  try {
                    const url = new URL(staff.facebookUrl);
                    return url.protocol === "https:" || url.protocol === "http:" ? (
                      <a
                        className="text-sky-700 underline"
                        href={url.toString()}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {staff.facebookUrl}
                      </a>
                    ) : (
                      staff.facebookUrl
                    );
                  } catch {
                    return staff.facebookUrl;
                  }
                })()}
              {!staff.facebookUrl ? "Chưa cập nhật" : null}
            </ProfileInfo>
            <ProfileInfo label="Trường Đại học">{optionalText(staff.university)}</ProfileInfo>
            <ProfileInfo label="Địa chỉ thường trú">
              {optionalText(staff.permanentAddress)}
            </ProfileInfo>
            <ProfileInfo label="Địa chỉ tạm trú">
              {optionalText(staff.temporaryAddress)}
            </ProfileInfo>
          </dl>
        </ProfileSection>

        <ProfileSection title="Ngân hàng">
          <dl className="grid gap-3 sm:grid-cols-2">
            <ProfileInfo label="Tên ngân hàng">{optionalText(staff.bankName)}</ProfileInfo>
            <ProfileInfo label="Số tài khoản">{optionalText(staff.bankAccountNumber)}</ProfileInfo>
          </dl>
        </ProfileSection>

        <ProfileSection title="Việc làm">
          <dl className="grid gap-3 sm:grid-cols-2">
            <ProfileInfo label="Chức danh">{optionalText(staff.jobTitle)}</ProfileInfo>
            <ProfileInfo label="Loại nhân sự">
              {employmentCategoryLabels[staff.employmentCategory]}
            </ProfileInfo>
            <ProfileInfo label="Trạng thái">
              {employmentStatusLabels[staff.employmentStatus]}
            </ProfileInfo>
            <ProfileInfo label="Ngày gia nhập">{displayBusinessDate(staff.joinedDate)}</ProfileInfo>
            <ProfileInfo label="Ngày chính thức">
              {displayBusinessDate(staff.officialDate)}
            </ProfileInfo>
            <ProfileInfo label="Ngày nghỉ việc">
              {displayBusinessDate(staff.terminationDate)}
            </ProfileInfo>
            <ProfileInfo label="Lương cơ bản">{money(staff.baseSalaryAmount)} ₫</ProfileInfo>
            <ProfileInfo label="Level hiện tại">
              {staff.level ? `${staff.level.code} · ${staff.level.name}` : "Chưa cập nhật"}
            </ProfileInfo>
            <ProfileInfo label="Tài khoản hệ thống">
              {staff.user
                ? `${staff.user.username ?? "Chưa có username"} · ${
                    staff.user.active ? "đang hoạt động" : "đã vô hiệu hóa"
                  }`
                : "Chưa liên kết"}
            </ProfileInfo>
          </dl>
        </ProfileSection>

        <ProfileSection title="Phân công hiện tại">
          {mayEdit ? (
            <button
              className="mb-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
              onClick={onManageAssignments}
              type="button"
            >
              Chuyển hoặc kết thúc phân công
            </button>
          ) : null}
          {staff.currentAssignments.length ? (
            <ul className="space-y-2 text-sm">
              {staff.currentAssignments.map((assignment) => (
                <li className="rounded-lg bg-slate-50 p-3" key={assignment.id}>
                  <strong>
                    {assignment.branchCode} — {assignment.branchName}
                  </strong>
                  <p className="mt-1 text-slate-600">
                    {assignmentTypeLabels[assignment.assignmentType]} · Mã máy:{" "}
                    {assignment.attendanceMachineCode ?? "chưa có"}
                  </p>
                  {assignment.assignmentType === "MEMBER" && mayEdit ? (
                    <AssignmentMachineCodeEditor
                      assignment={assignment}
                      key={`${assignment.id}:${assignment.version}:${assignment.attendanceMachineCode ?? ""}`}
                      onChanged={onChanged}
                      staffId={staff.id}
                      staffVersion={staff.version}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Không có phân công hiện hành.</p>
          )}
        </ProfileSection>
      </div>

      <ProfileSection title="Lịch sử chuyển cơ sở">
        {staff.assignmentHistory.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-[780px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Cơ sở</th>
                  <th className="px-3 py-2">Loại phân công</th>
                  <th className="px-3 py-2">Mã máy chấm công</th>
                  <th className="px-3 py-2">Từ ngày</th>
                  <th className="px-3 py-2">Đến ngày</th>
                  <th className="px-3 py-2">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {staff.assignmentHistory.map((assignment) => (
                  <tr className="border-t border-slate-100" key={assignment.id}>
                    <td className="px-3 py-3">
                      {assignment.branchCode} — {assignment.branchName}
                    </td>
                    <td className="px-3 py-3">{assignmentTypeLabels[assignment.assignmentType]}</td>
                    <td className="px-3 py-3">{assignment.attendanceMachineCode ?? "Chưa có"}</td>
                    <td className="px-3 py-3">{displayBusinessDate(assignment.effectiveFrom)}</td>
                    <td className="px-3 py-3">
                      {assignment.effectiveTo
                        ? displayBusinessDate(assignment.effectiveTo)
                        : "Hiện tại"}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={assignment.status === "CURRENT" ? "green" : "slate"}>
                        {assignmentStatusLabels[assignment.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Chưa có lịch sử phân công.</p>
        )}
      </ProfileSection>

      <ProfileSection title="Ca làm">
        {mayEdit ? (
          <AdministrationScheduleEditor
            currentSchedule={staff.currentSchedule}
            key={`${staff.currentSchedule?.id ?? "new"}:${staff.currentSchedule?.version ?? 0}`}
            onChanged={onChanged}
            staffId={staff.id}
          />
        ) : null}
        {staff.scheduleHistory.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-[740px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Tên ca</th>
                  <th className="px-3 py-2">Check-in chuẩn</th>
                  <th className="px-3 py-2">Check-out chuẩn</th>
                  <th className="px-3 py-2">Live cơ bản</th>
                  <th className="px-3 py-2">Hiệu lực</th>
                </tr>
              </thead>
              <tbody>
                {staff.scheduleHistory.map((schedule) => (
                  <tr className="border-t border-slate-100" key={schedule.id}>
                    <td className="px-3 py-3">
                      {schedule.name}
                      {schedule.spansNextDay ? (
                        <span className="ml-1 text-xs text-slate-500">(qua ngày)</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">{minutesAsTime(schedule.scheduledStartMinutes)}</td>
                    <td className="px-3 py-3">{minutesAsTime(schedule.scheduledEndMinutes)}</td>
                    <td className="px-3 py-3">{minutesAsTime(schedule.requiredLiveMinutes)}</td>
                    <td className="px-3 py-3">
                      {displayBusinessDate(schedule.effectiveFrom)} —{" "}
                      {schedule.effectiveTo
                        ? displayBusinessDate(schedule.effectiveTo)
                        : "hiện tại"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Chưa có lịch sử ca làm.</p>
        )}
      </ProfileSection>

      <ProfileSection title="Tài liệu riêng tư">
        <p className="mb-4 text-sm text-slate-600">
          Ảnh chỉ được tải sau khi bấm “Xem ảnh”. Liên kết xem có thời hạn ngắn và không được lưu
          trong trình duyệt.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <PrivateDocumentMetadataCard
            document={front}
            onView={(source) => void loadPreview(source)}
            title="CCCD mặt trước"
          />
          <PrivateDocumentMetadataCard
            document={back}
            onView={(source) => void loadPreview(source)}
            title="CCCD mặt sau"
          />
          <PrivateDocumentMetadataCard
            document={staff.bankQrDocument}
            onView={(source) => void loadPreview(source)}
            title="QR ngân hàng"
          />
        </div>
        {mayEdit ? (
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <AdminPrivateDocumentUpload
              kind="CITIZEN_ID_FRONT"
              onChanged={onChanged}
              staffId={staff.id}
            />
            <AdminPrivateDocumentUpload
              kind="CITIZEN_ID_BACK"
              onChanged={onChanged}
              staffId={staff.id}
            />
            <AdminPrivateDocumentUpload kind="BANK_QR" onChanged={onChanged} staffId={staff.id} />
          </div>
        ) : null}
      </ProfileSection>

      {preview ? (
        <div
          aria-label={`Xem ${preview.source.title}`}
          aria-modal="true"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-3 sm:p-6"
          role="dialog"
        >
          <button
            aria-label="Đóng ảnh"
            className="absolute inset-0"
            onClick={closePreview}
            type="button"
          />
          <div className="relative z-10 flex max-h-[90dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-4">
              <div className="min-w-0">
                <h3 className="break-words font-semibold">{preview.source.title}</h3>
                <p
                  className="break-words text-sm text-slate-500 [overflow-wrap:anywhere]"
                  title={preview.source.document.originalFileName}
                >
                  {preview.source.document.originalFileName}
                </p>
              </div>
              <button
                className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
                onClick={closePreview}
                type="button"
              >
                Đóng
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-4">
              {preview.phase === "LOADING" ? (
                <div className="grid min-h-64 place-items-center text-sm text-slate-600">
                  Đang tải ảnh…
                </div>
              ) : preview.phase === "FAILED" ? (
                <div className="grid min-h-64 place-items-center text-center">
                  <div>
                    <p className="text-sm text-rose-700">{preview.error}</p>
                    <button
                      className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
                      onClick={() => void loadPreview(preview.source)}
                      type="button"
                    >
                      Thử lại
                    </button>
                  </div>
                </div>
              ) : preview.url ? (
                <div className="grid min-h-64 place-items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={preview.source.title}
                    className="max-h-[68dvh] max-w-full object-contain"
                    onError={() =>
                      setPreview((current) =>
                        current
                          ? {
                              ...current,
                              phase: "FAILED",
                              url: null,
                              error: "Ảnh không tải được hoặc liên kết đã hết hạn. Hãy thử lại.",
                            }
                          : null,
                      )
                    }
                    referrerPolicy="no-referrer"
                    src={preview.url}
                  />
                </div>
              ) : null}
            </div>
            {preview.phase === "READY" && preview.url ? (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4">
                <p className="text-xs text-slate-500">
                  {preview.expiresInSeconds
                    ? `Liên kết hết hạn sau khoảng ${preview.expiresInSeconds} giây.`
                    : "Liên kết xem có thời hạn ngắn."}
                </p>
                <a
                  className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800"
                  href={preview.url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Mở ảnh gốc
                </a>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StaffRows({
  items,
  onAction,
  onView,
}: Readonly<{
  items: readonly AdminStaffDto[];
  onAction: (editor: EditorState) => void;
  onView: (staff: AdminStaffDto) => void;
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
                    ? item.currentAssignments
                        .map(
                          ({ branchCode, attendanceMachineCode }) =>
                            `${branchCode}${attendanceMachineCode ? ` · Máy ${attendanceMachineCode}` : ""}`,
                        )
                        .join(", ")
                    : "Chưa phân công"}
                  <p className="mt-1 text-xs text-slate-500">
                    Ca:{" "}
                    {item.currentSchedule
                      ? `${item.currentSchedule.name} · ${String(
                          Math.floor(item.currentSchedule.scheduledStartMinutes / 60),
                        ).padStart(2, "0")}:${String(
                          item.currentSchedule.scheduledStartMinutes % 60,
                        ).padStart(2, "0")}–${String(
                          Math.floor(item.currentSchedule.scheduledEndMinutes / 60),
                        ).padStart(2, "0")}:${String(
                          item.currentSchedule.scheduledEndMinutes % 60,
                        ).padStart(2, "0")}`
                      : "Chưa có"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    CCCD trước: {privateDocumentStatus(item.identityDocumentStatus.front)} · sau:{" "}
                    {privateDocumentStatus(item.identityDocumentStatus.back)} · QR:{" "}
                    {privateDocumentStatus(item.bankQrStatus)}
                  </p>
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
                  {item.terminationDate ? (
                    <p className="text-xs text-slate-500">
                      Nghỉ việc: {displayBusinessDate(item.terminationDate)}
                    </p>
                  ) : null}
                  {item.archivedAt ? (
                    <p className="mt-2">
                      <Badge tone="slate">Đã lưu trữ</Badge>
                    </p>
                  ) : null}
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
                  <div className="flex min-w-max flex-wrap gap-2">
                    <ActionButton onClick={() => onView(item)}>Xem hồ sơ</ActionButton>
                    {item.archivedAt ? (
                      <span className="self-center text-sm text-slate-500">Chỉ xem</span>
                    ) : (
                      <>
                        {item.employmentStatus !== "TERMINATED" ? (
                          <>
                            <ActionButton onClick={() => onAction({ kind: "staff-edit", item })}>
                              Sửa
                            </ActionButton>
                            <ActionButton
                              onClick={() => onAction({ kind: "staff-terminate", item })}
                              tone="warning"
                            >
                              Cho nghỉ việc
                            </ActionButton>
                          </>
                        ) : null}
                        {item.employmentStatus === "TERMINATED" && !item.terminationDate ? (
                          <ActionButton
                            onClick={() => onAction({ kind: "staff-terminate", item })}
                            tone="warning"
                          >
                            Bổ sung ngày nghỉ
                          </ActionButton>
                        ) : null}
                        {item.employmentStatus === "TERMINATED" ? (
                          <ActionButton
                            onClick={() => onAction({ kind: "staff-archive", item })}
                            tone="warning"
                          >
                            Lưu trữ
                          </ActionButton>
                        ) : null}
                      </>
                    )}
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
                {item.terminationDate ? (
                  <p className="text-sm text-slate-500">
                    Nghỉ việc: {displayBusinessDate(item.terminationDate)}
                  </p>
                ) : null}
              </div>
              <Badge tone={item.employmentStatus === "ACTIVE" ? "green" : "slate"}>
                {employmentStatusLabels[item.employmentStatus]}
              </Badge>
            </div>
            <p className="mt-3 text-sm">
              {item.currentAssignments
                .map(
                  ({ branchCode, attendanceMachineCode }) =>
                    `${branchCode}${attendanceMachineCode ? ` · Máy ${attendanceMachineCode}` : ""}`,
                )
                .join(", ") || "Chưa phân công"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Ca: {item.currentSchedule?.name ?? "Chưa có"} · CCCD trước:{" "}
              {privateDocumentStatus(item.identityDocumentStatus.front)} · CCCD sau:{" "}
              {privateDocumentStatus(item.identityDocumentStatus.back)} · QR:{" "}
              {privateDocumentStatus(item.bankQrStatus)}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <ActionButton onClick={() => onView(item)}>Xem hồ sơ</ActionButton>
              {item.archivedAt ? (
                <Badge tone="slate">Đã lưu trữ · chỉ xem</Badge>
              ) : item.employmentStatus !== "TERMINATED" ? (
                <>
                  <ActionButton onClick={() => onAction({ kind: "staff-edit", item })}>
                    Sửa
                  </ActionButton>
                  <ActionButton
                    onClick={() => onAction({ kind: "staff-terminate", item })}
                    tone="warning"
                  >
                    Cho nghỉ việc
                  </ActionButton>
                </>
              ) : (
                <>
                  {!item.terminationDate ? (
                    <ActionButton
                      onClick={() => onAction({ kind: "staff-terminate", item })}
                      tone="warning"
                    >
                      Bổ sung ngày nghỉ
                    </ActionButton>
                  ) : null}
                  <ActionButton
                    onClick={() => onAction({ kind: "staff-archive", item })}
                    tone="warning"
                  >
                    Lưu trữ
                  </ActionButton>
                </>
              )}
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
              <td className="px-4 py-4">
                {assignmentTypeLabels[item.assignmentType]}
                {item.attendanceMachineCode ? (
                  <p className="text-xs text-slate-500">Máy: {item.attendanceMachineCode}</p>
                ) : null}
              </td>
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
  capabilities,
  staffOptions,
}: Readonly<{
  activeBranchOptions: readonly Option[];
  assignableStaffOptions: readonly Option[];
  branchOptions: readonly Option[];
  capabilities: StaffWorkspaceCapabilities;
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
  const [profileStaffId, setProfileStaffId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const currentTab = tabs.find(({ id }) => id === tab)!;
  const showHidden = searchParams.get("showHidden") === "true";

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
    setProfileStaffId(null);
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
  const profileStaff =
    tab === "staff" && profileStaffId
      ? (((data?.items ?? []) as readonly AdminStaffDto[]).find(
          (item) => item.id === profileStaffId,
        ) ?? null)
      : null;

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
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => updateParams({ showHidden: showHidden ? null : "true", page: null })}
              variant="secondary"
            >
              {showHidden ? "Ẩn dữ liệu ngừng hoạt động" : "Xem dữ liệu đã ẩn"}
            </Button>
            <Button onClick={() => setDrawerOpen(true)}>
              Thêm {currentTab.label.toLowerCase()}
            </Button>
          </div>
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
                onView={(item) => {
                  setDrawerOpen(false);
                  setEditor(null);
                  setProfileStaffId(item.id);
                }}
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
            capabilities={capabilities}
            onSaved={saved}
            staff={tab === "assignments" ? assignableStaffOptions : staffOptions}
            tab={tab}
          />
        </Drawer>
      ) : null}
      {profileStaff ? (
        <Drawer
          onClose={() => setProfileStaffId(null)}
          title={`Hồ sơ nhân viên · ${profileStaff.fullName}`}
          wide
        >
          <AdminStaffProfile
            key={profileStaff.id}
            onChanged={(successMessage) => {
              setMessage(successMessage);
              setRefreshKey((value) => value + 1);
              router.refresh();
            }}
            onEdit={() => {
              setProfileStaffId(null);
              setEditor({ kind: "staff-edit", item: profileStaff });
            }}
            onManageAssignments={() => {
              const params = new URLSearchParams();
              params.set("tab", "assignments");
              params.set("staffId", profileStaff.id);
              setProfileStaffId(null);
              setData(null);
              router.push(`${pathname}?${params.toString()}`, { scroll: false });
            }}
            staff={profileStaff}
          />
        </Drawer>
      ) : null}
      {editor ? (
        <Drawer onClose={() => setEditor(null)} title={editorTitle(editor)}>
          <MutationForm
            branches={activeBranchOptions}
            capabilities={capabilities}
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
