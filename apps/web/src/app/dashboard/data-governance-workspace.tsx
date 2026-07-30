"use client";

import type {
  AuditLogDto,
  DataExportJobDto,
  ImportJobDto,
  ImportTemplateDefinitionDto,
  PayrollPeriodDto,
} from "@ald/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

type BranchOption = Readonly<{ id: string; code: string; name: string }>;

type ApiEnvelope<T> = Readonly<{
  data?: T;
  error?: Readonly<{ message?: string }>;
}>;

const exportLabels = {
  EMPLOYEE_ERROR_REPORT: "Báo lỗi nhân viên",
  BRANCH_MONTHLY: "Báo cáo tháng cơ sở",
  PAYSLIP: "Phiếu lương",
  COMPANY_MONTHLY: "Báo cáo tháng công ty",
  AUDIT: "Nhật ký audit",
} as const;

function dayEndExclusive(value: string): string {
  const start = new Date(`${value}T00:00:00+07:00`);
  return new Date(start.getTime() + 86_400_000).toISOString();
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message ?? "Yêu cầu không thành công.");
  }
  return payload.data;
}

async function checksumBase64(file: File): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function dateTime(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(
        new Date(value),
      )
    : "—";
}

function StatusBadge({ value }: { value: string }) {
  const success = ["SUCCEEDED", "VALIDATED"].includes(value);
  const danger = value === "FAILED";
  return (
    <span
      className={`rounded-full px-2 py-1 text-xs font-semibold ${
        success
          ? "bg-emerald-100 text-emerald-800"
          : danger
            ? "bg-rose-100 text-rose-800"
            : "bg-sky-100 text-sky-800"
      }`}
    >
      {value}
    </span>
  );
}

export function DataGovernanceWorkspace({
  branches,
  isGeneralManager,
}: {
  branches: readonly BranchOption[];
  isGeneralManager: boolean;
}) {
  const [templates, setTemplates] = useState<readonly ImportTemplateDefinitionDto[]>([]);
  const [imports, setImports] = useState<readonly ImportJobDto[]>([]);
  const [currentImport, setCurrentImport] = useState<ImportJobDto | null>(null);
  const [template, setTemplate] = useState<ImportJobDto["template"]>("ATTENDANCE_LIVE");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const [exports, setExports] = useState<readonly DataExportJobDto[]>([]);
  const [exportTemplate, setExportTemplate] =
    useState<DataExportJobDto["template"]>("BRANCH_MONTHLY");
  const [exportFormat, setExportFormat] = useState<"XLSX" | "CSV">("XLSX");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [staffId, setStaffId] = useState("");
  const [payrollPeriodId, setPayrollPeriodId] = useState("");
  const [payrollPeriods, setPayrollPeriods] = useState<readonly PayrollPeriodDto[]>([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [audits, setAudits] = useState<readonly AuditLogDto[]>([]);
  const [auditActor, setAuditActor] = useState("");
  const [auditAction, setAuditAction] = useState("");
  const [auditEntity, setAuditEntity] = useState("");
  const [auditEntityId, setAuditEntityId] = useState("");
  const [auditBranchId, setAuditBranchId] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [auditError, setAuditError] = useState<string | null>(null);

  const currentDefinition = useMemo(
    () => templates.find((item) => item.template === currentImport?.template),
    [currentImport?.template, templates],
  );
  const selectedPayrollPeriod = useMemo(
    () => payrollPeriods.find((period) => period.id === payrollPeriodId),
    [payrollPeriodId, payrollPeriods],
  );

  const loadImports = useCallback(async () => {
    setImports(await api<readonly ImportJobDto[]>("/api/imports?limit=20"));
  }, []);

  const loadExports = useCallback(async () => {
    setExports(await api<readonly DataExportJobDto[]>("/api/export-center?limit=20"));
  }, []);

  const loadAudits = useCallback(async () => {
    if (!isGeneralManager) return;
    const search = new URLSearchParams({ limit: "40" });
    if (auditActor) search.set("actorUserId", auditActor);
    if (auditAction) search.set("action", auditAction);
    if (auditEntity) search.set("entityType", auditEntity);
    if (auditEntityId) search.set("entityId", auditEntityId);
    if (auditBranchId) search.set("branchId", auditBranchId);
    if (auditFrom) search.set("from", new Date(`${auditFrom}T00:00:00+07:00`).toISOString());
    if (auditTo) search.set("to", dayEndExclusive(auditTo));
    try {
      setAuditError(null);
      const result = await api<{ items: readonly AuditLogDto[] }>(`/api/audit?${search}`);
      setAudits(result.items);
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : "Không thể tải audit.");
    }
  }, [
    auditAction,
    auditActor,
    auditBranchId,
    auditEntity,
    auditEntityId,
    auditFrom,
    auditTo,
    isGeneralManager,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([
        api<readonly ImportTemplateDefinitionDto[]>("/api/imports/templates").then(setTemplates),
        loadImports(),
        loadExports(),
      ]).catch((error: unknown) => {
        setImportError(error instanceof Error ? error.message : "Không thể tải dữ liệu.");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadExports, loadImports]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAudits(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAudits]);

  useEffect(() => {
    if (!exports.some((job) => job.status === "QUEUED" || job.status === "RUNNING")) return;
    const timer = window.setInterval(() => void loadExports(), 3_000);
    return () => window.clearInterval(timer);
  }, [exports, loadExports]);

  useEffect(() => {
    if (!isGeneralManager || exportTemplate !== "PAYSLIP") return;
    const timer = window.setTimeout(() => {
      void api<readonly PayrollPeriodDto[]>(`/api/payroll/periods?month=${month}`)
        .then((periods) => {
          setPayrollPeriods(periods);
          const selected = periods[0];
          setPayrollPeriodId(selected?.id ?? "");
          setStaffId(selected?.entries[0]?.staff.id ?? "");
        })
        .catch((error: unknown) =>
          setExportError(error instanceof Error ? error.message : "Không thể tải kỳ lương."),
        );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [exportTemplate, isGeneralManager, month]);

  function selectImport(job: ImportJobDto) {
    setCurrentImport(job);
    setMapping({ ...job.mapping });
  }

  async function uploadImport() {
    if (!file) {
      setImportError("Hãy chọn file XLSX hoặc CSV.");
      return;
    }
    setImportBusy(true);
    setImportError(null);
    try {
      const checksumSha256 = await checksumBase64(file);
      const mimeType = file.name.toLowerCase().endsWith(".csv")
        ? "text/csv"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const created = await api<{
        job: ImportJobDto;
        duplicate: boolean;
        upload: Readonly<{ url: string; headers: Readonly<Record<string, string>> }> | null;
      }>("/api/imports/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template,
          idempotencyKey: `${template}:${checksumSha256}`,
          originalFileName: file.name,
          mimeType,
          sizeBytes: file.size,
          checksumSha256,
          branchId: branchId || null,
        }),
      });
      let job = created.job;
      if (created.upload) {
        const upload = await fetch(created.upload.url, {
          method: "PUT",
          headers: { ...created.upload.headers },
          body: file,
        });
        if (!upload.ok) throw new Error("Upload private object thất bại.");
        job = await api<ImportJobDto>(`/api/imports/${job.id}/complete`, { method: "POST" });
      }
      selectImport(job);
      await loadImports();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Import upload thất bại.");
    } finally {
      setImportBusy(false);
    }
  }

  async function previewImport() {
    if (!currentImport) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const job = await api<ImportJobDto>(`/api/imports/${currentImport.id}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapping, dryRun: true }),
      });
      selectImport(job);
      await loadImports();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Preview thất bại.");
    } finally {
      setImportBusy(false);
    }
  }

  async function commitImport() {
    if (!currentImport) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const job = await api<ImportJobDto>(`/api/imports/${currentImport.id}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      selectImport(job);
      await Promise.all([loadImports(), loadAudits()]);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Commit thất bại.");
    } finally {
      setImportBusy(false);
    }
  }

  async function createExport() {
    setExportBusy(true);
    setExportError(null);
    try {
      await api<DataExportJobDto>("/api/export-center", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: exportTemplate,
          format: exportFormat,
          branchId:
            exportTemplate === "BRANCH_MONTHLY" || exportTemplate === "EMPLOYEE_ERROR_REPORT"
              ? branchId
              : null,
          month: exportTemplate === "AUDIT" || exportTemplate === "PAYSLIP" ? undefined : month,
          staffId: exportTemplate === "PAYSLIP" ? staffId : null,
          payrollPeriodId: exportTemplate === "PAYSLIP" ? payrollPeriodId : null,
          auditFilters:
            exportTemplate === "AUDIT"
              ? {
                  actorUserId: auditActor || undefined,
                  branchId: auditBranchId || undefined,
                  action: auditAction || undefined,
                  entityType: auditEntity || undefined,
                  entityId: auditEntityId || undefined,
                  from: auditFrom
                    ? new Date(`${auditFrom}T00:00:00+07:00`).toISOString()
                    : undefined,
                  to: auditTo ? dayEndExclusive(auditTo) : undefined,
                }
              : undefined,
        }),
      });
      await loadExports();
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Không thể tạo export.");
    } finally {
      setExportBusy(false);
    }
  }

  async function downloadExport(id: string) {
    try {
      const result = await api<{ url: string }>(`/api/export-center/${id}/download`);
      window.location.assign(result.url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Không thể tải file.");
    }
  }

  return (
    <section className="mt-8 space-y-6" aria-labelledby="data-governance-title">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-700">
          Data governance
        </p>
        <h2 id="data-governance-title" className="mt-1 text-2xl font-semibold">
          {isGeneralManager ? "Import, Export Center và Audit" : "Import và Export Center"}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Dữ liệu file được kiểm tra checksum, phạm vi cơ sở và formula injection trước khi ghi.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-semibold">1. Import dữ liệu cũ</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">
            Template
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              value={template}
              onChange={(event) => setTemplate(event.target.value as ImportJobDto["template"])}
            >
              {templates.map((item) => (
                <option key={item.template} value={item.template}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Cơ sở
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
            >
              {isGeneralManager ? <option value="">Toàn công ty / theo file</option> : null}
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.code} — {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm lg:col-span-2">
            File XLSX/CSV, tối đa 20 MB
            <input
              accept=".xlsx,.csv"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <button
            className="self-end rounded-lg bg-indigo-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
            disabled={importBusy}
            onClick={() => void uploadImport()}
            type="button"
          >
            {importBusy ? "Đang xử lý…" : "Upload và đọc file"}
          </button>
        </div>
        {importError ? <p className="mt-3 text-sm text-rose-700">{importError}</p> : null}

        {currentImport ? (
          <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium">{currentImport.originalFileName}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {currentImport.totalRows} dòng · checksum{" "}
                  {currentImport.checksumSha256.slice(0, 12)}…
                </div>
              </div>
              <StatusBadge value={currentImport.status} />
            </div>
            {currentDefinition && currentImport.sourceHeaders.length > 0 ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {currentDefinition.fields.map((target) => (
                  <label className="text-xs" key={target.key}>
                    {target.label}
                    {target.required ? " *" : ""}
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
                      value={mapping[target.key] ?? ""}
                      onChange={(event) =>
                        setMapping((value) => ({ ...value, [target.key]: event.target.value }))
                      }
                    >
                      <option value="">— Không map —</option>
                      {currentImport.sourceHeaders.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={importBusy}
                onClick={() => void previewImport()}
                type="button"
              >
                Dry-run / Preview
              </button>
              <button
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={
                  importBusy || currentImport.status !== "VALIDATED" || currentImport.errorRows > 0
                }
                onClick={() => void commitImport()}
                type="button"
              >
                Commit
              </button>
              {currentImport.errorRows > 0 ? (
                <a
                  className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700"
                  href={`/api/imports/${currentImport.id}/errors`}
                >
                  Tải file lỗi ({currentImport.errorRows})
                </a>
              ) : null}
            </div>
            {currentImport.status === "VALIDATED" ? (
              <p className="mt-3 text-sm text-slate-700">
                Hợp lệ: {currentImport.validRows} · Dòng lỗi: {currentImport.errorRows}
              </p>
            ) : null}
            {currentImport.errors.length > 0 ? (
              <div className="mt-3 max-h-48 overflow-auto rounded-lg bg-white p-3 text-xs">
                {currentImport.errors.slice(0, 20).map((item) => (
                  <div className="border-b border-slate-100 py-1" key={item.id}>
                    {item.sheetName}!{item.rowNumber} · {item.columnName}: {item.message}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2">File</th>
                <th className="px-2 py-2">Template</th>
                <th className="px-2 py-2">Trạng thái</th>
                <th className="px-2 py-2">Dòng</th>
                <th className="px-2 py-2">Tạo lúc</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((job) => (
                <tr
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  key={job.id}
                  onClick={() => selectImport(job)}
                >
                  <td className="px-2 py-2">{job.originalFileName}</td>
                  <td className="px-2 py-2">{job.template}</td>
                  <td className="px-2 py-2">
                    <StatusBadge value={job.status} />
                  </td>
                  <td className="px-2 py-2">
                    {job.committedRows}/{job.totalRows}
                  </td>
                  <td className="px-2 py-2">{dateTime(job.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-semibold">2. Export Center</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={exportTemplate}
            onChange={(event) =>
              setExportTemplate(event.target.value as DataExportJobDto["template"])
            }
          >
            {Object.entries(exportLabels)
              .filter(([key]) =>
                isGeneralManager ? true : ["EMPLOYEE_ERROR_REPORT", "BRANCH_MONTHLY"].includes(key),
              )
              .map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
          </select>
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={exportFormat}
            onChange={(event) => setExportFormat(event.target.value as "XLSX" | "CSV")}
          >
            <option value="XLSX">XLSX</option>
            <option value="CSV">CSV</option>
          </select>
          {exportTemplate !== "AUDIT" ? (
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          ) : null}
          {["BRANCH_MONTHLY", "EMPLOYEE_ERROR_REPORT"].includes(exportTemplate) ? (
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.code} — {branch.name}
                </option>
              ))}
            </select>
          ) : null}
          {exportTemplate === "PAYSLIP" ? (
            <>
              <select
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={payrollPeriodId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  const next = payrollPeriods.find((period) => period.id === nextId);
                  setPayrollPeriodId(nextId);
                  setStaffId(next?.entries[0]?.staff.id ?? "");
                }}
              >
                <option value="">Chọn kỳ lương</option>
                {payrollPeriods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.branch.code} · {period.month} · R{period.revision} · {period.status}
                  </option>
                ))}
              </select>
              <select
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={staffId}
                onChange={(event) => setStaffId(event.target.value)}
              >
                <option value="">Chọn nhân viên</option>
                {selectedPayrollPeriod?.entries.map((entry) => (
                  <option key={entry.staff.id} value={entry.staff.id}>
                    {entry.staff.staffCode} — {entry.staff.fullName}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <button
            className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={exportBusy}
            onClick={() => void createExport()}
            type="button"
          >
            Tạo export
          </button>
        </div>
        {exportError ? <p className="mt-3 text-sm text-rose-700">{exportError}</p> : null}
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2">Template</th>
                <th className="px-2 py-2">Định dạng</th>
                <th className="px-2 py-2">Trạng thái</th>
                <th className="px-2 py-2">Tiến độ</th>
                <th className="px-2 py-2">Hết hạn</th>
                <th className="px-2 py-2">File</th>
              </tr>
            </thead>
            <tbody>
              {exports.map((job) => (
                <tr className="border-t border-slate-100" key={job.id}>
                  <td className="px-2 py-2">{exportLabels[job.template]}</td>
                  <td className="px-2 py-2">{job.format}</td>
                  <td className="px-2 py-2">
                    <StatusBadge value={job.status} />
                  </td>
                  <td className="px-2 py-2">{job.progress}%</td>
                  <td className="px-2 py-2">{dateTime(job.expiresAt)}</td>
                  <td className="px-2 py-2">
                    {job.status === "SUCCEEDED" ? (
                      <button
                        className="font-semibold text-sky-700"
                        onClick={() => void downloadExport(job.id)}
                        type="button"
                      >
                        Tải xuống
                      </button>
                    ) : job.errorMessage ? (
                      <span className="text-rose-700">{job.errorMessage}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isGeneralManager ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h3 className="text-lg font-semibold">3. Audit Explorer</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Actor user ID"
              value={auditActor}
              onChange={(event) => setAuditActor(event.target.value)}
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Action"
              value={auditAction}
              onChange={(event) => setAuditAction(event.target.value)}
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Entity type"
              value={auditEntity}
              onChange={(event) => setAuditEntity(event.target.value)}
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Entity ID"
              value={auditEntityId}
              onChange={(event) => setAuditEntityId(event.target.value)}
            />
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={auditBranchId}
              onChange={(event) => setAuditBranchId(event.target.value)}
            >
              <option value="">Mọi cơ sở</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.code} — {branch.name}
                </option>
              ))}
            </select>
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              type="date"
              value={auditFrom}
              onChange={(event) => setAuditFrom(event.target.value)}
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              type="date"
              value={auditTo}
              onChange={(event) => setAuditTo(event.target.value)}
            />
            <button
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white"
              onClick={() => void loadAudits()}
              type="button"
            >
              Lọc audit
            </button>
          </div>
          {auditError ? <p className="mt-3 text-sm text-rose-700">{auditError}</p> : null}
          <div className="mt-4 space-y-3">
            {audits.length === 0 ? (
              <p className="text-sm text-slate-500">Không có audit phù hợp.</p>
            ) : (
              audits.map((log) => (
                <details
                  className="min-w-0 rounded-xl border border-slate-200 p-4 [overflow-wrap:anywhere]"
                  key={log.id}
                >
                  <summary className="cursor-pointer break-words">
                    <span className="break-words font-semibold">{log.action}</span>
                    <span className="ml-2 break-words text-sm text-slate-500">
                      {log.entityType} · {log.actor?.name ?? "SYSTEM"} · {dateTime(log.occurredAt)}
                    </span>
                  </summary>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm">
                    {log.reason}
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-xs">
                      <thead>
                        <tr className="text-slate-500">
                          <th className="py-1 pr-3">Trường</th>
                          <th className="py-1 pr-3">Trước</th>
                          <th className="py-1">Sau</th>
                        </tr>
                      </thead>
                      <tbody>
                        {log.changes.map((change) => (
                          <tr className="border-t border-slate-100" key={change.path}>
                            <td className="py-1 pr-3 font-mono">{change.path}</td>
                            <td className="py-1 pr-3 font-mono">{JSON.stringify(change.before)}</td>
                            <td className="py-1 font-mono">{JSON.stringify(change.after)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
