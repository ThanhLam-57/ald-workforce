"use client";

import type {
  BranchStaffDto,
  StaffBankQrDocumentDto,
  StaffCodePreviewDto,
  StaffIdentityDocumentDto,
  StaffStartDateCorrectionDto,
  StaffWorkScheduleDto,
} from "@ald/contracts";

import {
  uploadStaffPrivateDocument,
  type StaffPrivateDocumentKind,
} from "./private-document-upload";
import { apiErrorMessage, staffProfileFieldErrorsFrom } from "./staff-profile-field-errors";
import {
  StaffProfileFields,
  type StaffProfileEditorValues,
  type StaffProfileFieldErrors,
} from "./staff-profile-fields";
import { createStaffProfileUpdatePayload } from "./staff-profile-update";
import {
  canSubmitStaffOnboarding,
  isLatestStaffCodePreviewRequest,
} from "./staff-code-preview-state";
import type { StaffWorkspaceCapabilities } from "./staff-workspace-capabilities";
import { Button } from "@ald/ui";
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

type BranchOption = Readonly<{ id: string; code: string; name: string }>;
type ApiEnvelope<T> = Readonly<{
  data?: T;
  error?: Readonly<{
    message?: unknown;
  }>;
}>;
type UploadKind = StaffPrivateDocumentKind;
type PrivateDocumentMetadata = StaffIdentityDocumentDto | StaffBankQrDocumentDto;
type UploadState = Readonly<{
  phase: "PREPARING" | "UPLOADING" | "VERIFYING" | "SUCCEEDED" | "FAILED";
  message: string;
}>;
type StaffCodePreviewStatus = "IDLE" | "LOADING" | "READY" | "ERROR";

function businessToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());
}

function displayBusinessDate(value: string | null): string | null {
  if (!value) return null;
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function toMinutes(value: string): number | null {
  const match = /^(\d{2}):([0-5]\d)$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23) return null;
  return hours * 60 + minutes;
}

function toTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(
    2,
    "0",
  )}`;
}

function messageFrom(payload: ApiEnvelope<unknown>, fallback: string): string {
  return apiErrorMessage(payload, fallback);
}

function nullable(value: string): string | null {
  return value.trim() || null;
}

function documentForSide(
  staff: BranchStaffDto,
  side: StaffIdentityDocumentDto["side"],
): StaffIdentityDocumentDto | null {
  return staff.identityDocuments.find((document) => document.side === side) ?? null;
}

function documentStatus(status: string | null | undefined): string {
  if (status === "READY") return "Đã lưu";
  if (status === "PENDING_UPLOAD") return "Chờ tải lên";
  if (status === "REJECTED") return "Tải lên thất bại";
  return "Chưa có";
}

function formatFileSize(sizeBytes: string): string {
  const bytes = Number(sizeBytes);
  if (!Number.isFinite(bytes)) return `${sizeBytes} byte`;
  if (bytes < 1024) return `${bytes} byte`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} MB`;
}

function formatUploadedAt(value: string | null): string {
  if (!value) return "Chưa hoàn tất";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMoney(value: string): string {
  try {
    return `${new Intl.NumberFormat("vi-VN").format(BigInt(value))} ₫`;
  } catch {
    return value;
  }
}

const emptyForm = {
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
  joinedDate: businessToday(),
  officialDate: "",
  employmentCategory: "PROBATION" as "OFFICIAL" | "PROBATION" | "CONTRACTOR" | "INTERN",
  employmentStatus: "ACTIVE" as "ACTIVE" | "ON_LEAVE" | "TERMINATED",
  effectiveFrom: businessToday(),
  baseSalaryAmount: "0",
  branchId: "",
  scheduleName: "Ca Live",
  scheduledStart: "09:00",
  scheduledEnd: "15:00",
  requiredLive: "06:00",
};

function profileForm(person: BranchStaffDto) {
  return {
    staffCode: person.staffCode,
    attendanceMachineCode: person.attendanceMachineCode ?? "",
    fullName: person.fullName,
    streamingAlias: person.streamingAlias ?? "",
    tiktokChannelId: person.tiktokChannelId ?? "",
    email: person.email ?? "",
    phone: person.phone ?? "",
    dateOfBirth: person.dateOfBirth ?? "",
    citizenIdNumber: person.citizenIdNumber ?? "",
    bankAccountNumber: person.bankAccountNumber ?? "",
    bankName: person.bankName ?? "",
    permanentAddress: person.permanentAddress ?? "",
    temporaryAddress: person.temporaryAddress ?? "",
    facebookUrl: person.facebookUrl ?? "",
    university: person.university ?? "",
    jobTitle: person.jobTitle,
    joinedDate: person.joinedDate ?? "",
    officialDate: person.officialDate ?? "",
    employmentCategory: person.employmentCategory,
    employmentStatus: person.employmentStatus,
    effectiveFrom: businessToday(),
    baseSalaryAmount: person.baseSalaryAmount ?? "",
  };
}

export function StaffWorkspace({
  capabilities,
  initialBranches,
  initialStaff,
}: Readonly<{
  capabilities: StaffWorkspaceCapabilities;
  initialBranches: readonly BranchOption[];
  initialStaff: readonly BranchStaffDto[];
}>) {
  const [staff, setStaff] = useState(initialStaff);
  const [branchFilter, setBranchFilter] = useState(initialBranches[0]?.id ?? "");
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [showInactive, setShowInactive] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ ...emptyForm, branchId: initialBranches[0]?.id ?? "" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<ReturnType<typeof profileForm> | null>(null);
  const [schedule, setSchedule] = useState({
    id: null as string | null,
    version: null as number | null,
    name: "Ca Live",
    scheduledStart: "09:00",
    scheduledEnd: "15:00",
    requiredLive: "06:00",
    effectiveFrom: businessToday(),
    effectiveTo: "",
  });
  const [scheduleHistory, setScheduleHistory] = useState<readonly StaffWorkScheduleDto[]>([]);
  const [showTerminationDialog, setShowTerminationDialog] = useState(false);
  const [terminationDate, setTerminationDate] = useState("");
  const [terminationError, setTerminationError] = useState<string | null>(null);
  const [showStartDateDialog, setShowStartDateDialog] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [startDateReason, setStartDateReason] = useState("");
  const [startDateError, setStartDateError] = useState<string | null>(null);
  const [createFiles, setCreateFiles] = useState<Partial<Record<UploadKind, File>>>({});
  const [uploadStates, setUploadStates] = useState<Readonly<Record<string, UploadState>>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createFieldErrors, setCreateFieldErrors] = useState<StaffProfileFieldErrors>({});
  const [editFieldErrors, setEditFieldErrors] = useState<StaffProfileFieldErrors>({});
  const [staffCodePreviewStatus, setStaffCodePreviewStatus] =
    useState<StaffCodePreviewStatus>("IDLE");
  const [staffCodePreviewReloadKey, setStaffCodePreviewReloadKey] = useState(0);
  const staffCodePreviewRequestId = useRef(0);

  useEffect(() => {
    if (!showCreate) {
      setStaffCodePreviewStatus("IDLE");
      return;
    }

    const branchId = form.branchId;
    const requestId = ++staffCodePreviewRequestId.current;
    if (!branchId) {
      setForm((current) => ({ ...current, staffCode: "" }));
      setStaffCodePreviewStatus("ERROR");
      setCreateFieldErrors((current) => ({
        ...current,
        staffCode: ["Vui lòng chọn cơ sở để tạo mã nhân viên."],
      }));
      return;
    }

    const controller = new AbortController();
    setStaffCodePreviewStatus("LOADING");
    setCreateFieldErrors((current) => ({ ...current, staffCode: undefined }));
    setForm((current) => (current.branchId === branchId ? { ...current, staffCode: "" } : current));

    async function loadPreview(): Promise<void> {
      try {
        const response = await fetch(
          `/api/staff/onboard/code-preview?branchId=${encodeURIComponent(branchId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = (await response.json()) as ApiEnvelope<StaffCodePreviewDto>;
        if (!response.ok || !payload.data) {
          throw new Error(messageFrom(payload, "Không thể tạo mã nhân viên đề xuất."));
        }
        const preview = payload.data;
        setForm((current) =>
          isLatestStaffCodePreviewRequest({
            currentBranchId: current.branchId,
            latestRequestId: staffCodePreviewRequestId.current,
            requestedBranchId: branchId,
            requestId,
          }) && preview.branchId === branchId
            ? { ...current, staffCode: preview.suggestedStaffCode }
            : current,
        );
        if (requestId === staffCodePreviewRequestId.current) {
          setStaffCodePreviewStatus("READY");
        }
      } catch (caught) {
        if (controller.signal.aborted || requestId !== staffCodePreviewRequestId.current) return;
        setStaffCodePreviewStatus("ERROR");
        setCreateFieldErrors((current) => ({
          ...current,
          staffCode: [
            caught instanceof Error ? caught.message : "Không thể tạo mã nhân viên đề xuất.",
          ],
        }));
      }
    }

    void loadPreview();
    return () => controller.abort();
  }, [form.branchId, showCreate, staffCodePreviewReloadKey]);

  const filteredStaff = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("vi");
    return staff.filter((person) => {
      if (branchFilter && person.branch.id !== branchFilter) return false;
      if (statusFilter !== "ALL" && person.employmentStatus !== statusFilter) return false;
      if (categoryFilter !== "ALL" && person.employmentCategory !== categoryFilter) return false;
      if (!keyword) return true;
      return [
        person.fullName,
        person.staffCode,
        person.attendanceMachineCode,
        person.streamingAlias,
        person.tiktokChannelId,
        person.phone,
      ].some((value) => value?.toLocaleLowerCase("vi").includes(keyword));
    });
  }, [branchFilter, categoryFilter, search, staff, statusFilter]);
  const selected = staff.find((person) => person.id === selectedId) ?? null;

  function setCurrentEditForm(action: React.SetStateAction<ReturnType<typeof profileForm>>): void {
    setEditForm((current) => {
      if (!current) return current;
      return typeof action === "function" ? action(current) : action;
    });
  }

  async function reloadStaff(selectId?: string, includeInactive = showInactive): Promise<void> {
    const response = await fetch(
      `/api/staff/onboard${includeInactive ? "?includeInactive=1" : ""}`,
      {
        cache: "no-store",
      },
    );
    const payload = (await response.json()) as ApiEnvelope<readonly BranchStaffDto[]>;
    if (!response.ok || !payload.data) {
      throw new Error(messageFrom(payload, "Không thể tải lại danh sách nhân viên."));
    }
    setStaff(payload.data);
    if (selectId) setSelectedId(selectId);
  }

  async function toggleInactive(): Promise<void> {
    const next = !showInactive;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/staff/onboard${next ? "?includeInactive=1" : ""}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as ApiEnvelope<readonly BranchStaffDto[]>;
      if (!response.ok || !payload.data) {
        throw new Error(
          messageFrom(payload, "Không thể tải danh sách nhân viên đã ngừng hoạt động."),
        );
      }
      setShowInactive(next);
      setStaff(payload.data);
      setStatusFilter(next ? "ALL" : "ACTIVE");
      if (!next && selected?.employmentStatus === "TERMINATED") closeDetails();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể tải danh sách nhân viên đã ngừng hoạt động.",
      );
    } finally {
      setPending(false);
    }
  }

  async function terminateSelected(): Promise<void> {
    if (
      !selected ||
      !capabilities.canTerminateStaff ||
      selected.employmentStatus === "TERMINATED"
    ) {
      return;
    }
    if (!terminationDate) {
      setTerminationError("Vui lòng chọn ngày nghỉ việc.");
      return;
    }
    if (terminationDate > businessToday()) {
      setTerminationError("Ngày nghỉ việc không được sau ngày hiện tại.");
      return;
    }
    if (selected.joinedDate && terminationDate < selected.joinedDate) {
      setTerminationError("Ngày nghỉ việc không được trước ngày gia nhập.");
      return;
    }
    setPending(true);
    setTerminationError(null);
    try {
      const response = await fetch(`/api/staff/${encodeURIComponent(selected.id)}/terminate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminationDate,
          version: selected.version,
        }),
      });
      const payload = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok) {
        throw new Error(messageFrom(payload, "Không thể cho nhân viên nghỉ việc."));
      }
      setMessage(`Đã ghi nhận ngày nghỉ việc của ${selected.fullName}.`);
      setShowTerminationDialog(false);
      setTerminationDate("");
      setTerminationError(null);
      setShowInactive(true);
      setStatusFilter("ALL");
      await reloadStaff(selected.id, true);
    } catch (caught) {
      setTerminationError(
        caught instanceof Error ? caught.message : "Không thể cho nhân viên nghỉ việc.",
      );
    } finally {
      setPending(false);
    }
  }

  function openTerminationDialog(): void {
    if (
      !selected ||
      !capabilities.canTerminateStaff ||
      selected.employmentStatus === "TERMINATED"
    ) {
      return;
    }
    setTerminationDate(businessToday());
    setTerminationError(null);
    setShowTerminationDialog(true);
  }

  function closeTerminationDialog(): void {
    if (pending) return;
    setShowTerminationDialog(false);
    setTerminationDate("");
    setTerminationError(null);
  }

  async function loadScheduleHistory(staffId: string): Promise<void> {
    const response = await fetch(`/api/staff/${encodeURIComponent(staffId)}/schedules`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as ApiEnvelope<readonly StaffWorkScheduleDto[]>;
    if (response.ok && payload.data) setScheduleHistory(payload.data);
  }

  async function uploadPrivateDocument(
    targetStaff: BranchStaffDto,
    kind: UploadKind,
    file: File,
  ): Promise<void> {
    if (!capabilities.canUploadPrivateDocuments) {
      throw new Error("Bạn không có quyền cập nhật tài liệu riêng tư.");
    }
    const stateKey = `${targetStaff.id}:${kind}`;
    try {
      await uploadStaffPrivateDocument({
        staffId: targetStaff.id,
        kind,
        file,
        onPhase: (phase) => {
          const messageByPhase = {
            PREPARING: "Đang chuẩn bị...",
            UPLOADING: "Đang tải ảnh...",
            VERIFYING: "Đang xác minh...",
          } as const;
          setUploadStates((current) => ({
            ...current,
            [stateKey]: { phase, message: messageByPhase[phase] },
          }));
        },
      });
    } catch (caught) {
      const uploadMessage = caught instanceof Error ? caught.message : "Không thể tải ảnh.";
      setUploadStates((current) => ({
        ...current,
        [stateKey]: { phase: "FAILED", message: uploadMessage },
      }));
      throw new Error(uploadMessage, { cause: caught });
    }
    setUploadStates((current) => ({
      ...current,
      [stateKey]: { phase: "SUCCEEDED", message: "Tải ảnh thành công." },
    }));
  }

  async function createStaff(): Promise<void> {
    if (
      !canSubmitStaffOnboarding({
        branchId: form.branchId,
        pending,
        previewStatus: staffCodePreviewStatus,
        staffCode: form.staffCode,
      })
    ) {
      setCreateFieldErrors((current) => ({
        ...current,
        staffCode: ["Vui lòng đợi hệ thống tạo mã nhân viên trước khi lưu."],
      }));
      return;
    }
    setPending(true);
    setError(null);
    setMessage(null);
    setCreateFieldErrors({});
    try {
      const scheduledStartMinutes = toMinutes(form.scheduledStart);
      const scheduledEndMinutes = toMinutes(form.scheduledEnd);
      const requiredLiveMinutes = toMinutes(form.requiredLive);
      if (
        scheduledStartMinutes === null ||
        scheduledEndMinutes === null ||
        requiredLiveMinutes === null ||
        requiredLiveMinutes < 1
      ) {
        throw new Error("Ca làm và thời lượng Live phải có định dạng HH:mm hợp lệ.");
      }
      const response = await fetch("/api/staff/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attendanceMachineCode: form.attendanceMachineCode,
          fullName: form.fullName,
          streamingAlias: nullable(form.streamingAlias),
          tiktokChannelId: nullable(form.tiktokChannelId),
          email: nullable(form.email),
          phone: nullable(form.phone),
          dateOfBirth: nullable(form.dateOfBirth),
          citizenIdNumber: nullable(form.citizenIdNumber),
          bankAccountNumber: nullable(form.bankAccountNumber),
          bankName: nullable(form.bankName),
          permanentAddress: nullable(form.permanentAddress),
          temporaryAddress: nullable(form.temporaryAddress),
          facebookUrl: nullable(form.facebookUrl),
          university: nullable(form.university),
          jobTitle: form.jobTitle,
          joinedDate: form.joinedDate,
          officialDate: nullable(form.officialDate),
          employmentCategory: form.employmentCategory,
          ...(capabilities.canEditSalary
            ? { baseSalaryAmount: form.baseSalaryAmount.trim() || "0" }
            : {}),
          branchId: form.branchId,
          initialSchedule: {
            name: form.scheduleName,
            scheduledStartMinutes,
            scheduledEndMinutes,
            spansNextDay: scheduledEndMinutes <= scheduledStartMinutes,
            requiredLiveMinutes,
          },
        }),
      });
      const payload = (await response.json()) as ApiEnvelope<BranchStaffDto>;
      if (!response.ok || !payload.data) {
        setCreateFieldErrors(staffProfileFieldErrorsFrom(payload, response.status));
        throw new Error(messageFrom(payload, "Không thể thêm nhân viên."));
      }

      const uploadErrors: string[] = [];
      for (const kind of ["CITIZEN_ID_FRONT", "CITIZEN_ID_BACK", "BANK_QR"] as const) {
        const file = createFiles[kind];
        if (!file) continue;
        try {
          await uploadPrivateDocument(payload.data, kind, file);
        } catch (caught) {
          uploadErrors.push(
            `${kind === "BANK_QR" ? "QR ngân hàng" : kind === "CITIZEN_ID_FRONT" ? "CCCD mặt trước" : "CCCD mặt sau"}: ${
              caught instanceof Error ? caught.message : "không thể tải ảnh"
            }`,
          );
        }
      }
      await reloadStaff(payload.data.id);
      setBranchFilter(payload.data.branch.id);
      setShowCreate(false);
      setCreateFiles({});
      setCreateFieldErrors({});
      setForm({ ...emptyForm, branchId: payload.data.branch.id });
      setMessage(`Đã thêm nhân viên ${payload.data.staffCode}, phân công cơ sở và ca làm ban đầu.`);
      if (uploadErrors.length) {
        setError(
          `Hồ sơ đã được tạo và không bị hoàn tác. Các ảnh sau tải thất bại: ${uploadErrors.join(
            " ",
          )}`,
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể thêm nhân viên.");
    } finally {
      setPending(false);
    }
  }

  async function saveProfile(): Promise<void> {
    if (!selected || !editForm) return;
    setPending(true);
    setError(null);
    setMessage(null);
    setEditFieldErrors({});
    try {
      const response = await fetch(`/api/staff/${encodeURIComponent(selected.id)}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createStaffProfileUpdatePayload(selected, editForm, {
            canEditAssignment: capabilities.canEditAssignment,
            canEditSalary: capabilities.canEditSalary,
          }),
        ),
      });
      const payload = (await response.json()) as ApiEnvelope<BranchStaffDto>;
      if (!response.ok || !payload.data) {
        setEditFieldErrors(staffProfileFieldErrorsFrom(payload, response.status));
        throw new Error(
          messageFrom(
            payload,
            response.status === 409
              ? "Dữ liệu đã thay đổi. Hãy tải lại hồ sơ."
              : "Không thể lưu hồ sơ.",
          ),
        );
      }
      await reloadStaff(selected.id);
      setEditForm(profileForm(payload.data));
      setEditFieldErrors({});
      setEditing(false);
      setMessage("Đã lưu thay đổi hồ sơ nhân viên.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể lưu hồ sơ.");
    } finally {
      setPending(false);
    }
  }

  async function saveSchedule(): Promise<void> {
    if (!selected || !capabilities.canEditSchedule) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const scheduledStartMinutes = toMinutes(schedule.scheduledStart);
      const scheduledEndMinutes = toMinutes(schedule.scheduledEnd);
      const requiredLiveMinutes = toMinutes(schedule.requiredLive);
      if (
        scheduledStartMinutes === null ||
        scheduledEndMinutes === null ||
        requiredLiveMinutes === null ||
        requiredLiveMinutes < 1
      ) {
        throw new Error("Ca làm và thời lượng Live phải có định dạng HH:mm hợp lệ.");
      }
      const updating = schedule.id !== null && schedule.version !== null;
      const endpoint = updating
        ? `/api/staff/${encodeURIComponent(selected.id)}/schedules/${encodeURIComponent(schedule.id!)}`
        : `/api/staff/${encodeURIComponent(selected.id)}/schedules`;
      const response = await fetch(endpoint, {
        method: updating ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: schedule.name,
          scheduledStartMinutes,
          scheduledEndMinutes,
          spansNextDay: scheduledEndMinutes <= scheduledStartMinutes,
          requiredLiveMinutes,
          effectiveFrom: schedule.effectiveFrom,
          effectiveTo: nullable(schedule.effectiveTo),
          ...(updating ? { version: schedule.version } : {}),
        }),
      });
      const payload = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok) {
        throw new Error(messageFrom(payload, "Không thể thiết lập ca mới."));
      }
      await Promise.all([reloadStaff(selected.id), loadScheduleHistory(selected.id)]);
      setSchedule({
        id: null,
        version: null,
        name: "Ca Live",
        scheduledStart: "09:00",
        scheduledEnd: "15:00",
        requiredLive: "06:00",
        effectiveFrom: businessToday(),
        effectiveTo: "",
      });
      setMessage(updating ? "Đã cập nhật ca làm." : "Đã lưu ca mới theo ngày hiệu lực.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể thiết lập ca mới.");
    } finally {
      setPending(false);
    }
  }

  function openStartDateDialog(): void {
    if (!selected || !capabilities.canCorrectStartDate) return;
    const defaultDate =
      selected.joinedDate && selected.joinedDate < selected.assignmentEffectiveFrom
        ? selected.joinedDate
        : selected.assignmentEffectiveFrom;
    setStartDate(defaultDate);
    setStartDateReason("");
    setStartDateError(null);
    setShowStartDateDialog(true);
  }

  function closeStartDateDialog(): void {
    if (pending) return;
    setShowStartDateDialog(false);
    setStartDate("");
    setStartDateReason("");
    setStartDateError(null);
  }

  async function correctStartDate(): Promise<void> {
    if (!selected || !capabilities.canCorrectStartDate) return;
    if (!startDate) {
      setStartDateError("Vui lòng chọn ngày bắt đầu cần đồng bộ.");
      return;
    }
    if (!startDateReason.trim()) {
      setStartDateError("Vui lòng nhập lý do điều chỉnh hồi tố.");
      return;
    }

    setPending(true);
    setStartDateError(null);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/staff/${encodeURIComponent(selected.id)}/start-date`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetDate: startDate,
          reason: startDateReason.trim(),
          staffVersion: selected.version,
          assignmentId: selected.assignmentId,
          assignmentVersion: selected.assignmentVersion,
        }),
      });
      const payload = (await response.json()) as ApiEnvelope<StaffStartDateCorrectionDto>;
      if (!response.ok || !payload.data) {
        throw new Error(messageFrom(payload, "Không thể đồng bộ ngày bắt đầu."));
      }
      await Promise.all([reloadStaff(selected.id), loadScheduleHistory(selected.id)]);
      setShowStartDateDialog(false);
      setStartDate("");
      setStartDateReason("");
      setMessage(
        payload.data.scheduleAdjusted
          ? "Đã đồng bộ ngày gia nhập, phân công, lịch sử việc làm và ca làm."
          : "Đã đồng bộ ngày gia nhập, phân công và lịch sử việc làm; ca hiện có đã bao phủ ngày này.",
      );
    } catch (caught) {
      setStartDateError(
        caught instanceof Error ? caught.message : "Không thể đồng bộ ngày bắt đầu.",
      );
    } finally {
      setPending(false);
    }
  }

  async function uploadInEdit(kind: UploadKind, file: File): Promise<void> {
    if (!selected || !capabilities.canUploadPrivateDocuments) return;
    setPending(true);
    setError(null);
    try {
      await uploadPrivateDocument(selected, kind, file);
      await reloadStaff(selected.id);
      setMessage("Đã cập nhật ảnh riêng tư.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể tải ảnh.");
    } finally {
      setPending(false);
    }
  }

  async function viewPrivateDocument(kind: UploadKind, documentId: string): Promise<void> {
    if (!selected || !editing || !capabilities.canViewPrivateDocuments) return;
    const viewer = globalThis.open("about:blank", "_blank");
    if (viewer) viewer.opener = null;
    try {
      const path =
        kind === "BANK_QR"
          ? `/api/staff/${encodeURIComponent(selected.id)}/bank-qr/${encodeURIComponent(
              documentId,
            )}/view`
          : `/api/staff/${encodeURIComponent(
              selected.id,
            )}/identity-documents/${encodeURIComponent(documentId)}/view`;
      const response = await fetch(path, { cache: "no-store" });
      const payload = (await response.json()) as ApiEnvelope<{ url: string }>;
      if (!response.ok || !payload.data) {
        throw new Error(messageFrom(payload, "Không thể mở ảnh."));
      }
      if (viewer) viewer.location.href = payload.data.url;
      else globalThis.open(payload.data.url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      viewer?.close();
      setError(caught instanceof Error ? caught.message : "Không thể mở ảnh.");
    }
  }

  function openDetails(person: BranchStaffDto): void {
    setSelectedId(person.id);
    setEditing(false);
    setEditForm(profileForm(person));
    setShowTerminationDialog(false);
    setShowStartDateDialog(false);
    setStartDate("");
    setStartDateReason("");
    setStartDateError(null);
    setTerminationDate("");
    setTerminationError(null);
    setUploadStates({});
    setError(null);
    setEditFieldErrors({});
    const current = person.currentSchedule;
    setSchedule({
      id: null,
      version: null,
      name: current?.name ?? "Ca Live",
      scheduledStart: current ? toTime(current.scheduledStartMinutes) : "09:00",
      scheduledEnd: current ? toTime(current.scheduledEndMinutes) : "15:00",
      requiredLive: current ? toTime(current.requiredLiveMinutes) : "06:00",
      effectiveFrom: businessToday(),
      effectiveTo: "",
    });
    void loadScheduleHistory(person.id);
  }

  function closeDetails(): void {
    setSelectedId(null);
    setEditing(false);
    setEditForm(null);
    setShowTerminationDialog(false);
    setShowStartDateDialog(false);
    setStartDate("");
    setStartDateReason("");
    setStartDateError(null);
    setTerminationDate("");
    setTerminationError(null);
    setError(null);
    setUploadStates({});
    setEditFieldErrors({});
    setScheduleHistory([]);
  }

  return (
    <section className="mt-6 space-y-4">
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-5">
        <Field label="Cơ sở">
          <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
            {initialBranches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} — {branch.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Trạng thái">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="ALL">Tất cả</option>
            <option value="ACTIVE">Đang làm</option>
            <option value="ON_LEAVE">Tạm nghỉ</option>
            {showInactive ? <option value="TERMINATED">Đã nghỉ việc</option> : null}
          </select>
        </Field>
        <Field label="Loại nhân sự">
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="ALL">Tất cả</option>
            <option value="PROBATION">Thử việc</option>
            <option value="OFFICIAL">Chính thức</option>
            <option value="CONTRACTOR">Hợp đồng</option>
            <option value="INTERN">Thực tập</option>
          </select>
        </Field>
        <Field label="Tìm kiếm">
          <input
            placeholder="Tên, mã hồ sơ, mã máy, TikTok, SĐT"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <div className="flex items-end justify-end gap-2">
          {capabilities.canTerminateStaff ? (
            <button
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              disabled={pending}
              type="button"
              onClick={() => void toggleInactive()}
            >
              {showInactive ? "Ẩn nhân viên đã nghỉ" : "Hiện nhân viên đã nghỉ"}
            </button>
          ) : null}
          <Button
            type="button"
            onClick={() => {
              setShowCreate((value) => !value);
              setCreateFieldErrors({});
            }}
          >
            {showCreate ? "Đóng form" : "Thêm nhân viên"}
          </Button>
        </div>
      </div>

      {message ? <Notice tone="success">{message}</Notice> : null}
      {error && !selected ? <Notice tone="error">{error}</Notice> : null}

      {showCreate ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold">Hồ sơ nhân viên mới</h2>
          <FormSections
            capabilities={capabilities}
            errors={createFieldErrors}
            form={form}
            includeBranch
            branches={initialBranches}
            staffCodePreviewStatus={staffCodePreviewStatus}
            onRetryStaffCode={() => setStaffCodePreviewReloadKey((current) => current + 1)}
            setForm={setForm}
            onFieldChanged={(field) =>
              setCreateFieldErrors((current) => ({ ...current, [field]: undefined }))
            }
          />
          <h3 className="mt-6 font-semibold">Ca làm ban đầu</h3>
          <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Tên ca">
              <input
                value={form.scheduleName}
                onChange={(event) =>
                  setForm((value) => ({ ...value, scheduleName: event.target.value }))
                }
              />
            </Field>
            <Field label="Check-in chuẩn">
              <input
                type="time"
                value={form.scheduledStart}
                onChange={(event) =>
                  setForm((value) => ({ ...value, scheduledStart: event.target.value }))
                }
              />
            </Field>
            <Field label="Check-out chuẩn">
              <input
                type="time"
                value={form.scheduledEnd}
                onChange={(event) =>
                  setForm((value) => ({ ...value, scheduledEnd: event.target.value }))
                }
              />
            </Field>
            <Field label="Live cơ bản (HH:mm)">
              <input
                type="time"
                value={form.requiredLive}
                onChange={(event) =>
                  setForm((value) => ({ ...value, requiredLive: event.target.value }))
                }
              />
            </Field>
          </div>
          {capabilities.canUploadPrivateDocuments ? (
            <>
              <h3 className="mt-6 font-semibold">Ảnh riêng tư (không bắt buộc)</h3>
              <div className="mt-3 grid gap-4 md:grid-cols-3">
                <FilePicker
                  label="CCCD mặt trước"
                  onFile={(file) =>
                    setCreateFiles((current) => ({ ...current, CITIZEN_ID_FRONT: file }))
                  }
                />
                <FilePicker
                  label="CCCD mặt sau"
                  onFile={(file) =>
                    setCreateFiles((current) => ({ ...current, CITIZEN_ID_BACK: file }))
                  }
                />
                <FilePicker
                  label="QR ngân hàng"
                  onFile={(file) => setCreateFiles((current) => ({ ...current, BANK_QR: file }))}
                />
              </div>
            </>
          ) : null}
          <div className="mt-4 flex justify-end">
            <Button
              disabled={
                !canSubmitStaffOnboarding({
                  branchId: form.branchId,
                  pending,
                  previewStatus: staffCodePreviewStatus,
                  staffCode: form.staffCode,
                })
              }
              onClick={() => void createStaff()}
              type="button"
            >
              {pending ? "Đang lưu..." : "Lưu nhân viên"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-auto rounded-2xl border border-slate-200 bg-white">
        <table className="min-w-[1320px] text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-4 py-3">Mã nhân viên</th>
              <th className="px-4 py-3">Mã máy chấm công</th>
              <th className="px-4 py-3">Họ và tên</th>
              <th className="px-4 py-3">Tên kênh TikTok</th>
              <th className="px-4 py-3">ID TikTok</th>
              <th className="px-4 py-3">Số điện thoại</th>
              <th className="px-4 py-3">Cơ sở</th>
              <th className="px-4 py-3">Ca hiện hành</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {filteredStaff.map((person) => (
              <tr className="border-t border-slate-200" key={person.id}>
                <td className="px-4 py-3 font-medium">{person.staffCode}</td>
                <td className="px-4 py-3">{person.attendanceMachineCode ?? "Chưa cập nhật"}</td>
                <td className="px-4 py-3 font-medium">{person.fullName}</td>
                <td className="px-4 py-3">{person.streamingAlias ?? "—"}</td>
                <td className="px-4 py-3">
                  {person.tiktokChannelId ? `@${person.tiktokChannelId}` : "—"}
                </td>
                <td className="px-4 py-3">{person.phone ?? "—"}</td>
                <td className="px-4 py-3">
                  {person.branch.code} — {person.branch.name}
                </td>
                <td className="px-4 py-3">
                  {person.currentSchedule
                    ? `${toTime(person.currentSchedule.scheduledStartMinutes)}–${toTime(
                        person.currentSchedule.scheduledEndMinutes,
                      )}`
                    : "Chưa có"}
                </td>
                <td className="px-4 py-3">
                  {person.employmentStatus === "ACTIVE"
                    ? "Đang làm"
                    : person.employmentStatus === "TERMINATED"
                      ? "Đã nghỉ việc"
                      : "Tạm nghỉ"}
                </td>
                <td className="px-4 py-3">
                  <Button type="button" onClick={() => openDetails(person)}>
                    Xem hồ sơ
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredStaff.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            Không có nhân viên phù hợp bộ lọc trong phạm vi của bạn.
          </p>
        ) : null}
      </div>

      {selected && editForm ? (
        <div
          aria-label={`Hồ sơ nhân viên ${selected.fullName}`}
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-slate-950/50 p-2 sm:p-4"
          role="dialog"
        >
          <div className="flex max-h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div
              className="z-10 flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-white p-4 sm:p-5"
              data-testid="staff-profile-header"
            >
              <div className="min-w-0 flex-1 basis-64">
                <h2 className="break-words text-xl font-semibold">{selected.fullName}</h2>
                <p className="break-words text-sm text-slate-600">
                  {selected.staffCode} · {selected.branch.code} — {selected.branch.name}
                </p>
              </div>
              <div className="flex max-w-full shrink-0 flex-wrap justify-end gap-2 max-sm:w-full">
                {!editing && selected.employmentStatus !== "TERMINATED" ? (
                  <Button
                    type="button"
                    onClick={() => {
                      setEditFieldErrors({});
                      setEditing(true);
                    }}
                  >
                    Chỉnh sửa
                  </Button>
                ) : editing ? (
                  <>
                    <button
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      type="button"
                      onClick={() => {
                        setEditing(false);
                        setEditFieldErrors({});
                        setEditForm(profileForm(selected));
                      }}
                    >
                      Hủy
                    </button>
                    <Button disabled={pending} type="button" onClick={() => void saveProfile()}>
                      {pending ? "Đang lưu..." : "Lưu thay đổi"}
                    </Button>
                  </>
                ) : null}
                <button
                  aria-label="Đóng"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  onClick={closeDetails}
                  type="button"
                >
                  Đóng
                </button>
              </div>
            </div>

            <div
              className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 [overflow-wrap:anywhere] sm:p-5"
              data-testid="staff-profile-scroll-region"
            >
              {error ? (
                <div className="mb-4">
                  <Notice tone="error">{error}</Notice>
                </div>
              ) : null}
              {editing ? (
                <FormSections
                  capabilities={capabilities}
                  errors={editFieldErrors}
                  form={editForm}
                  setForm={setCurrentEditForm}
                  onFieldChanged={(field) => {
                    setError(null);
                    setEditFieldErrors((current) => ({ ...current, [field]: undefined }));
                  }}
                />
              ) : (
                <ProfileReadOnly canViewSalary={capabilities.canViewSalary} person={selected} />
              )}

              {!editing &&
              capabilities.canCorrectStartDate &&
              selected.employmentStatus !== "TERMINATED" ? (
                <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-amber-950">Ngày bắt đầu dữ liệu lịch sử</h3>
                      <p className="mt-1 text-sm text-amber-900">
                        Ngày gia nhập: {displayBusinessDate(selected.joinedDate) ?? "chưa có"} ·
                        Phân công tại {selected.branch.code}: từ{" "}
                        {displayBusinessDate(selected.assignmentEffectiveFrom)}
                      </p>
                      {selected.joinedDate &&
                      selected.joinedDate < selected.assignmentEffectiveFrom ? (
                        <p className="mt-2 text-sm font-medium text-rose-700" role="status">
                          Phân công bắt đầu sau ngày gia nhập nên nhân viên có thể bị ẩn khỏi chấm
                          công tháng cũ.
                        </p>
                      ) : (
                        <p className="mt-2 text-sm text-amber-800">
                          Chỉ dùng thao tác hồi tố khi hồ sơ được tạo nhầm ngày bắt đầu.
                        </p>
                      )}
                    </div>
                    <button
                      className="shrink-0 rounded-lg bg-amber-900 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                      disabled={pending}
                      type="button"
                      onClick={openStartDateDialog}
                    >
                      Đồng bộ ngày bắt đầu
                    </button>
                  </div>
                </section>
              ) : null}

              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <section className="rounded-xl border border-slate-200 p-4">
                  <h3 className="font-semibold">Ca làm</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Ca hiện hành:{" "}
                    {selected.currentSchedule
                      ? `${selected.currentSchedule.name}, ${toTime(
                          selected.currentSchedule.scheduledStartMinutes,
                        )}–${toTime(
                          selected.currentSchedule.scheduledEndMinutes,
                        )}, Live ${toTime(selected.currentSchedule.requiredLiveMinutes)}`
                      : "chưa có"}
                  </p>
                  {editing && capabilities.canEditSchedule ? (
                    <>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <Field label="Tên ca">
                          <input
                            value={schedule.name}
                            onChange={(event) =>
                              setSchedule((value) => ({ ...value, name: event.target.value }))
                            }
                          />
                        </Field>
                        <Field label="Ngày áp dụng">
                          <input
                            type="date"
                            value={schedule.effectiveFrom}
                            onChange={(event) =>
                              setSchedule((value) => ({
                                ...value,
                                effectiveFrom: event.target.value,
                              }))
                            }
                          />
                        </Field>
                        <Field label="Ngày kết thúc (không bắt buộc)">
                          <input
                            type="date"
                            value={schedule.effectiveTo}
                            onChange={(event) =>
                              setSchedule((value) => ({
                                ...value,
                                effectiveTo: event.target.value,
                              }))
                            }
                          />
                        </Field>
                        <Field label="Check-in chuẩn">
                          <input
                            type="time"
                            value={schedule.scheduledStart}
                            onChange={(event) =>
                              setSchedule((value) => ({
                                ...value,
                                scheduledStart: event.target.value,
                              }))
                            }
                          />
                        </Field>
                        <Field label="Check-out chuẩn">
                          <input
                            type="time"
                            value={schedule.scheduledEnd}
                            onChange={(event) =>
                              setSchedule((value) => ({
                                ...value,
                                scheduledEnd: event.target.value,
                              }))
                            }
                          />
                        </Field>
                        <Field label="Live cơ bản">
                          <input
                            type="time"
                            value={schedule.requiredLive}
                            onChange={(event) =>
                              setSchedule((value) => ({
                                ...value,
                                requiredLive: event.target.value,
                              }))
                            }
                          />
                        </Field>
                      </div>
                      <div className="mt-3 flex justify-end gap-2">
                        {schedule.id ? (
                          <button
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            type="button"
                            onClick={() =>
                              setSchedule({
                                id: null,
                                version: null,
                                name: "Ca Live",
                                scheduledStart: "09:00",
                                scheduledEnd: "15:00",
                                requiredLive: "06:00",
                                effectiveFrom: businessToday(),
                                effectiveTo: "",
                              })
                            }
                          >
                            Hủy sửa ca
                          </button>
                        ) : null}
                        <Button
                          disabled={pending}
                          onClick={() => void saveSchedule()}
                          type="button"
                        >
                          {schedule.id ? "Lưu sửa ca" : "Lưu ca mới"}
                        </Button>
                      </div>
                    </>
                  ) : null}
                  <div className="mt-4 max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 text-sm">
                    <strong>Lịch sử ca</strong>
                    {scheduleHistory.length ? (
                      <ul className="mt-2 space-y-1">
                        {scheduleHistory.map((item) => (
                          <li
                            className="flex items-start justify-between gap-2 border-b border-slate-200 py-1 last:border-0"
                            key={item.id}
                          >
                            <span className="min-w-0 break-words">
                              {item.effectiveFrom}
                              {item.effectiveTo
                                ? ` đến ${item.effectiveTo}`
                                : " đến hiện tại"}: {item.name} ·{" "}
                              {toTime(item.scheduledStartMinutes)}–
                              {toTime(item.scheduledEndMinutes)} · Live{" "}
                              {toTime(item.requiredLiveMinutes)}
                            </span>
                            {editing && capabilities.canEditSchedule ? (
                              <button
                                className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs"
                                type="button"
                                onClick={() =>
                                  setSchedule({
                                    id: item.id,
                                    version: item.version,
                                    name: item.name,
                                    scheduledStart: toTime(item.scheduledStartMinutes),
                                    scheduledEnd: toTime(item.scheduledEndMinutes),
                                    requiredLive: toTime(item.requiredLiveMinutes),
                                    effectiveFrom: item.effectiveFrom,
                                    effectiveTo: item.effectiveTo ?? "",
                                  })
                                }
                              >
                                Sửa
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-slate-500">Chưa có lịch sử ca.</p>
                    )}
                  </div>
                </section>

                <section className="rounded-xl border border-slate-200 p-4">
                  <h3 className="font-semibold">Tài liệu riêng tư</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Chế độ xem chỉ hiển thị trạng thái. Hệ thống không tự tải ảnh hoặc tạo signed
                    URL.
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <PrivateDocumentCard
                      title="CCCD mặt trước"
                      document={documentForSide(selected, "CITIZEN_ID_FRONT")}
                      state={uploadStates[`${selected.id}:CITIZEN_ID_FRONT`]}
                      editing={editing && capabilities.canUploadPrivateDocuments}
                      pending={pending}
                      onFile={(file) => void uploadInEdit("CITIZEN_ID_FRONT", file)}
                      onView={
                        capabilities.canViewPrivateDocuments &&
                        documentForSide(selected, "CITIZEN_ID_FRONT")?.status === "READY"
                          ? () =>
                              void viewPrivateDocument(
                                "CITIZEN_ID_FRONT",
                                documentForSide(selected, "CITIZEN_ID_FRONT")!.id,
                              )
                          : undefined
                      }
                    />
                    <PrivateDocumentCard
                      title="CCCD mặt sau"
                      document={documentForSide(selected, "CITIZEN_ID_BACK")}
                      state={uploadStates[`${selected.id}:CITIZEN_ID_BACK`]}
                      editing={editing && capabilities.canUploadPrivateDocuments}
                      pending={pending}
                      onFile={(file) => void uploadInEdit("CITIZEN_ID_BACK", file)}
                      onView={
                        capabilities.canViewPrivateDocuments &&
                        documentForSide(selected, "CITIZEN_ID_BACK")?.status === "READY"
                          ? () =>
                              void viewPrivateDocument(
                                "CITIZEN_ID_BACK",
                                documentForSide(selected, "CITIZEN_ID_BACK")!.id,
                              )
                          : undefined
                      }
                    />
                    <PrivateDocumentCard
                      title="QR ngân hàng"
                      document={selected.bankQrDocument}
                      state={uploadStates[`${selected.id}:BANK_QR`]}
                      editing={editing && capabilities.canUploadPrivateDocuments}
                      pending={pending}
                      onFile={(file) => void uploadInEdit("BANK_QR", file)}
                      onView={
                        capabilities.canViewPrivateDocuments &&
                        selected.bankQrDocument?.status === "READY"
                          ? () => void viewPrivateDocument("BANK_QR", selected.bankQrDocument!.id)
                          : undefined
                      }
                    />
                  </div>
                </section>
              </div>

              {!editing &&
              capabilities.canTerminateStaff &&
              selected.employmentStatus !== "TERMINATED" ? (
                <section className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4">
                  <h3 className="font-semibold text-rose-900">Cho nhân viên nghỉ việc</h3>
                  <p className="mt-1 text-sm text-rose-800">
                    Dữ liệu lịch sử vẫn được giữ nguyên; thao tác này không xóa chấm công hay bảng
                    lương.
                  </p>
                  <div className="mt-3 flex justify-end">
                    <button
                      className="rounded-lg bg-rose-700 px-4 py-2 font-medium text-white hover:bg-rose-800 disabled:opacity-50"
                      disabled={pending}
                      type="button"
                      onClick={openTerminationDialog}
                    >
                      Cho nhân viên nghỉ việc
                    </button>
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {showStartDateDialog &&
      selected &&
      capabilities.canCorrectStartDate &&
      selected.employmentStatus !== "TERMINATED" ? (
        <div
          aria-describedby="correct-start-date-description"
          aria-labelledby="correct-start-date-title"
          aria-modal="true"
          className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4"
          role="dialog"
        >
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words text-xl font-semibold" id="correct-start-date-title">
                  Đồng bộ ngày bắt đầu
                </h2>
                <p className="mt-1 break-words text-sm text-slate-600">
                  {selected.fullName} · {selected.staffCode} · {selected.branch.code}
                </p>
              </div>
              <button
                aria-label="Đóng điều chỉnh ngày bắt đầu"
                className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                disabled={pending}
                type="button"
                onClick={closeStartDateDialog}
              >
                Đóng
              </button>
            </div>

            <div
              className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
              id="correct-start-date-description"
            >
              <p>
                Hệ thống sẽ đồng bộ ngày gia nhập, phân công cơ sở đầu tiên và lịch sử việc làm. Ca
                làm chỉ được kéo lùi khi chưa có ca nào bao phủ ngày mới.
              </p>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase text-amber-700">
                    Ngày gia nhập hiện tại
                  </dt>
                  <dd>{displayBusinessDate(selected.joinedDate) ?? "Chưa có"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase text-amber-700">
                    Phân công hiện tại từ
                  </dt>
                  <dd>{displayBusinessDate(selected.assignmentEffectiveFrom)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase text-amber-700">Ca sớm nhất từ</dt>
                  <dd>
                    {displayBusinessDate(
                      scheduleHistory[scheduleHistory.length - 1]?.effectiveFrom ??
                        selected.currentSchedule?.effectiveFrom ??
                        null,
                    ) ?? "Chưa có"}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="mt-4 grid gap-4">
              <Field label="Ngày bắt đầu cần đồng bộ">
                <input
                  autoFocus
                  max={
                    selected.joinedDate && selected.joinedDate < selected.assignmentEffectiveFrom
                      ? selected.joinedDate
                      : selected.assignmentEffectiveFrom
                  }
                  required
                  type="date"
                  value={startDate}
                  onChange={(event) => {
                    setStartDate(event.target.value);
                    setStartDateError(null);
                  }}
                />
              </Field>
              <Field label="Lý do điều chỉnh hồi tố">
                <textarea
                  className="min-h-24"
                  maxLength={500}
                  placeholder="Ví dụ: Hồ sơ được tạo tháng 8 nhưng nhân viên đã làm việc từ tháng 6."
                  required
                  value={startDateReason}
                  onChange={(event) => {
                    setStartDateReason(event.target.value);
                    setStartDateError(null);
                  }}
                />
              </Field>
              {startDateError ? (
                <p className="text-sm text-rose-700" role="alert">
                  {startDateError}
                </p>
              ) : null}
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                disabled={pending}
                type="button"
                onClick={closeStartDateDialog}
              >
                Hủy
              </button>
              <button
                className="rounded-lg bg-slate-950 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                disabled={pending}
                type="button"
                onClick={() => void correctStartDate()}
              >
                {pending ? "Đang đồng bộ…" : "Xác nhận đồng bộ"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showTerminationDialog &&
      selected &&
      capabilities.canTerminateStaff &&
      selected.employmentStatus !== "TERMINATED" ? (
        <div
          aria-describedby="terminate-staff-description"
          aria-labelledby="terminate-staff-title"
          aria-modal="true"
          className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4"
          role="alertdialog"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2
                  className="break-words text-xl font-semibold text-rose-900"
                  id="terminate-staff-title"
                >
                  Xác nhận cho nhân viên nghỉ việc
                </h2>
                <p className="mt-1 break-words text-sm text-slate-600">
                  {selected.fullName} · {selected.staffCode}
                </p>
              </div>
              <button
                aria-label="Đóng xác nhận nghỉ việc"
                className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                disabled={pending}
                type="button"
                onClick={closeTerminationDialog}
              >
                Đóng
              </button>
            </div>

            <div
              className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
              id="terminate-staff-description"
            >
              <p className="font-medium">Dữ liệu lịch sử vẫn được giữ nguyên.</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Chấm công và bảng lương đã có không bị xóa.</li>
                <li>Phân công tương lai sẽ được đóng theo ngày nghỉ việc.</li>
                <li>Tài khoản có thể bị vô hiệu hóa và các phiên đăng nhập bị thu hồi.</li>
              </ul>
            </div>

            <div className="mt-4">
              <Field label="Ngày nghỉ việc">
                <input
                  autoFocus
                  max={businessToday()}
                  min={selected.joinedDate ?? undefined}
                  type="date"
                  value={terminationDate}
                  onChange={(event) => {
                    setTerminationDate(event.target.value);
                    setTerminationError(null);
                  }}
                />
              </Field>
              {terminationError ? (
                <p className="mt-2 text-sm text-rose-700" role="alert">
                  {terminationError}
                </p>
              ) : null}
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                disabled={pending}
                type="button"
                onClick={closeTerminationDialog}
              >
                Hủy
              </button>
              <button
                className="rounded-lg bg-rose-700 px-4 py-2 font-medium text-white hover:bg-rose-800 disabled:opacity-50"
                disabled={pending}
                type="button"
                onClick={() => void terminateSelected()}
              >
                {pending ? "Đang xử lý..." : "Xác nhận cho nghỉ việc"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function FormSections<T extends StaffProfileEditorValues & { branchId?: string }>({
  capabilities,
  errors,
  form,
  branches = [],
  includeBranch = false,
  onRetryStaffCode,
  onFieldChanged,
  setForm,
  staffCodePreviewStatus = "IDLE",
}: Readonly<{
  capabilities: StaffWorkspaceCapabilities;
  errors: StaffProfileFieldErrors;
  form: T;
  setForm: Dispatch<SetStateAction<T>>;
  branches?: readonly BranchOption[];
  includeBranch?: boolean;
  onRetryStaffCode?: () => void;
  onFieldChanged: (field: string) => void;
  staffCodePreviewStatus?: StaffCodePreviewStatus;
}>) {
  function changeProfileField(field: keyof StaffProfileEditorValues, value: string): void {
    onFieldChanged(field);
    setForm((current) => ({ ...current, [field]: value }) as T);
  }

  return (
    <>
      {includeBranch && form.branchId !== undefined ? (
        <>
          <h3 className="mt-5 font-semibold">Phân công ban đầu</h3>
          <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field error={errors.branchId?.[0]} label="Cơ sở">
              <select
                disabled={!capabilities.canEditAssignment}
                value={form.branchId}
                onChange={(event) => {
                  onFieldChanged("branchId");
                  setForm((current) => ({ ...current, branchId: event.target.value }));
                }}
              >
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.code} — {branch.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </>
      ) : null}
      <StaffProfileFields
        capabilities={capabilities}
        errors={errors}
        joinedDateRequired={includeBranch}
        onChange={changeProfileField}
        officialDateRequired={includeBranch}
        staffCodeLoading={includeBranch && staffCodePreviewStatus === "LOADING"}
        staffCodeReadOnly={includeBranch}
        {...(includeBranch
          ? {
              staffCodeStatus:
                staffCodePreviewStatus === "LOADING"
                  ? "Đang tạo mã theo cơ sở đã chọn..."
                  : "Mã được hệ thống tự động tạo theo cơ sở khi lưu.",
            }
          : {})}
        {...(includeBranch && staffCodePreviewStatus === "ERROR" && onRetryStaffCode
          ? { onRetryStaffCode }
          : {})}
        today={businessToday()}
        values={form}
      />
    </>
  );
}

function ProfileReadOnly({
  canViewSalary,
  person,
}: Readonly<{ canViewSalary: boolean; person: BranchStaffDto }>) {
  return (
    <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Info label="Mã nhân viên" value={person.staffCode} />
      <Info label="Mã máy chấm công" value={person.attendanceMachineCode} />
      <Info label="Họ và tên" value={person.fullName} />
      <Info label="Ngày sinh" value={person.dateOfBirth} />
      <Info label="Vị trí công việc" value={person.jobTitle} />
      <Info label="Loại nhân sự" value={person.employmentCategory} />
      <Info label="Ngày gia nhập" value={displayBusinessDate(person.joinedDate)} />
      <Info
        label={`Phân công tại ${person.branch.code} từ`}
        value={displayBusinessDate(person.assignmentEffectiveFrom)}
      />
      <Info label="Ngày chính thức" value={displayBusinessDate(person.officialDate)} />
      {person.employmentStatus === "TERMINATED" ? (
        <Info label="Ngày nghỉ việc" value={displayBusinessDate(person.terminationDate)} />
      ) : null}
      <Info label="Trạng thái" value={person.employmentStatus} />
      {canViewSalary && person.baseSalaryAmount !== undefined ? (
        <Info label="Lương cơ bản" value={formatMoney(person.baseSalaryAmount)} />
      ) : null}
      <Info label="Tên kênh TikTok / ACC" value={person.streamingAlias} />
      <Info
        label="ID kênh TikTok"
        value={person.tiktokChannelId ? `@${person.tiktokChannelId}` : null}
      />
      <Info label="Link Facebook" value={person.facebookUrl} />
      <Info label="Số điện thoại" value={person.phone} />
      <Info label="Email" value={person.email} />
      <Info label="Địa chỉ thường trú" value={person.permanentAddress} />
      <Info label="Địa chỉ tạm trú" value={person.temporaryAddress} />
      <Info label="Trường Đại học" value={person.university} />
      <Info label="Tên ngân hàng" value={person.bankName} />
      <Info label="Số tài khoản" value={person.bankAccountNumber} />
      <Info label="Số CCCD / CMND" value={person.citizenIdNumber} />
    </div>
  );
}

function Info({ label, value }: Readonly<{ label: string; value: string | null }>) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm">{value || "Chưa cập nhật"}</p>
    </div>
  );
}

function FilePicker({ label, onFile }: Readonly<{ label: string; onFile: (file: File) => void }>) {
  return (
    <Field label={label}>
      <input
        accept="image/jpeg,image/png,image/webp"
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
        }}
      />
    </Field>
  );
}

function PrivateDocumentCard({
  title,
  document,
  state,
  editing,
  pending,
  onFile,
  onView,
}: Readonly<{
  title: string;
  document: PrivateDocumentMetadata | null;
  state: UploadState | undefined;
  editing: boolean;
  pending: boolean;
  onFile: (file: File) => void;
  onView: (() => void) | undefined;
}>) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 p-3">
      <strong className="block">{title}</strong>
      <p className="mt-1 text-sm text-slate-600">{documentStatus(document?.status)}</p>
      {document ? (
        <dl className="mt-2 space-y-1 text-xs text-slate-600">
          <div>
            <dt className="inline font-medium">File: </dt>
            <dd className="inline break-all">{document.originalFileName}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Dung lượng: </dt>
            <dd className="inline">{formatFileSize(document.sizeBytes)}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Tải lên: </dt>
            <dd className="inline">{formatUploadedAt(document.uploadedAt)}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Phiên bản: </dt>
            <dd className="inline">v{document.version}</dd>
          </div>
        </dl>
      ) : null}
      {state ? (
        <p
          className={`mt-2 break-words text-xs ${
            state.phase === "FAILED" ? "text-rose-700" : "text-sky-700"
          }`}
        >
          {state.message}
        </p>
      ) : null}
      {editing ? (
        <>
          <input
            accept="image/jpeg,image/png,image/webp"
            className="mt-3 block w-full text-xs"
            disabled={pending}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
              event.target.value = "";
            }}
          />
          {onView ? (
            <button
              className="mt-3 text-sm font-medium text-sky-700 underline"
              type="button"
              onClick={onView}
            >
              Xem ảnh hiện có
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Notice({
  tone,
  children,
}: Readonly<{ tone: "success" | "error"; children: React.ReactNode }>) {
  return (
    <p
      className={`rounded-xl border p-3 text-sm ${
        tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-rose-200 bg-rose-50 text-rose-800"
      }`}
    >
      {children}
    </p>
  );
}

function Field({
  label,
  children,
  className = "",
  error,
}: Readonly<{
  label: string;
  children: React.ReactNode;
  className?: string;
  error?: string | undefined;
}>) {
  return (
    <label className={`grid gap-1 text-sm font-medium ${className}`}>
      {label}
      {children}
      {error ? (
        <span className="text-xs font-normal text-rose-700" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}
