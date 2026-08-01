"use client";

import { useId, type ChangeEvent, type ReactNode } from "react";

import type { StaffWorkspaceCapabilities } from "./staff-workspace-capabilities";

export type StaffProfileFieldErrors = Readonly<Record<string, readonly string[] | undefined>>;

export type StaffProfileEditorValues = Readonly<{
  staffCode: string;
  attendanceMachineCode: string;
  fullName: string;
  streamingAlias: string;
  tiktokChannelId: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  citizenIdNumber: string;
  bankAccountNumber: string;
  bankName: string;
  permanentAddress: string;
  temporaryAddress: string;
  facebookUrl: string;
  university: string;
  jobTitle: string;
  joinedDate: string;
  officialDate: string;
  employmentCategory: "OFFICIAL" | "PROBATION" | "CONTRACTOR" | "INTERN";
  employmentStatus: "ACTIVE" | "ON_LEAVE" | "TERMINATED";
  effectiveFrom: string;
  baseSalaryAmount: string;
}>;

export type StaffProfileFieldName = keyof StaffProfileEditorValues;

function firstError(
  errors: StaffProfileFieldErrors,
  field: StaffProfileFieldName,
): string | undefined {
  return errors[field]?.[0];
}

function ProfileField({
  children,
  error,
  label,
}: Readonly<{
  children: (descriptionId: string | undefined) => ReactNode;
  error: string | undefined;
  label: string;
}>) {
  const errorId = useId();
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      {children(error ? errorId : undefined)}
      {error ? (
        <span className="text-xs font-normal text-rose-700" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function StaffProfileFields({
  capabilities,
  errors = {},
  joinedDateRequired = false,
  onChange,
  officialDateRequired = false,
  showAttendanceMachineCode = true,
  showEmploymentControls = false,
  staffCodeLoading = false,
  staffCodeReadOnly = false,
  staffCodeStatus,
  onRetryStaffCode,
  today,
  values,
}: Readonly<{
  capabilities: StaffWorkspaceCapabilities;
  errors?: StaffProfileFieldErrors;
  joinedDateRequired?: boolean;
  onChange: (field: StaffProfileFieldName, value: string) => void;
  officialDateRequired?: boolean;
  showAttendanceMachineCode?: boolean;
  showEmploymentControls?: boolean;
  staffCodeLoading?: boolean;
  staffCodeReadOnly?: boolean;
  staffCodeStatus?: string;
  onRetryStaffCode?: () => void;
  today: string;
  values: StaffProfileEditorValues;
}>) {
  const staffCodeStatusId = useId();
  function inputProps(field: StaffProfileFieldName) {
    const error = firstError(errors, field);
    return {
      "aria-invalid": error ? true : undefined,
      name: field,
      value: values[field],
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        onChange(field, event.target.value),
    } as const;
  }

  return (
    <>
      <h3 className="mt-5 font-semibold">A. Thông tin cơ bản</h3>
      <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ProfileField error={firstError(errors, "fullName")} label="Họ và tên">
          {(descriptionId) => (
            <input {...inputProps("fullName")} aria-describedby={descriptionId} required />
          )}
        </ProfileField>
        <ProfileField error={firstError(errors, "staffCode")} label="Mã nhân viên">
          {(descriptionId) => (
            <div className="grid gap-1">
              <input
                {...inputProps("staffCode")}
                aria-busy={staffCodeLoading || undefined}
                aria-describedby={
                  [descriptionId, staffCodeStatus ? staffCodeStatusId : undefined]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                className={staffCodeReadOnly ? "bg-slate-100 text-slate-700" : undefined}
                readOnly={staffCodeReadOnly}
                required
              />
              {staffCodeStatus ? (
                <span className="text-xs font-normal text-slate-600" id={staffCodeStatusId}>
                  {staffCodeStatus}
                </span>
              ) : null}
              {onRetryStaffCode ? (
                <button
                  className="w-fit text-xs font-medium text-sky-700 underline"
                  type="button"
                  onClick={onRetryStaffCode}
                >
                  Thử tạo lại mã
                </button>
              ) : null}
            </div>
          )}
        </ProfileField>
        {showAttendanceMachineCode ? (
          <ProfileField
            error={firstError(errors, "attendanceMachineCode")}
            label="Mã máy chấm công"
          >
            {(descriptionId) => (
              <input
                {...inputProps("attendanceMachineCode")}
                aria-describedby={descriptionId}
                disabled={!capabilities.canEditAssignment}
              />
            )}
          </ProfileField>
        ) : null}
        <ProfileField error={firstError(errors, "dateOfBirth")} label="Ngày sinh">
          {(descriptionId) => (
            <input
              {...inputProps("dateOfBirth")}
              aria-describedby={descriptionId}
              max={today}
              type="date"
            />
          )}
        </ProfileField>
        <ProfileField error={firstError(errors, "jobTitle")} label="Vị trí công việc">
          {(descriptionId) => (
            <input {...inputProps("jobTitle")} aria-describedby={descriptionId} required />
          )}
        </ProfileField>
        <ProfileField error={firstError(errors, "employmentCategory")} label="Loại nhân sự">
          {(descriptionId) => (
            <select {...inputProps("employmentCategory")} aria-describedby={descriptionId}>
              <option value="PROBATION">Thử việc</option>
              <option value="OFFICIAL">Chính thức</option>
              <option value="CONTRACTOR">Hợp đồng</option>
              <option value="INTERN">Thực tập</option>
            </select>
          )}
        </ProfileField>
        <ProfileField error={firstError(errors, "joinedDate")} label="Ngày gia nhập">
          {(descriptionId) => (
            <input
              {...inputProps("joinedDate")}
              aria-describedby={descriptionId}
              required={joinedDateRequired}
              type="date"
            />
          )}
        </ProfileField>
        <ProfileField error={firstError(errors, "officialDate")} label="Ngày chính thức">
          {(descriptionId) => (
            <input
              {...inputProps("officialDate")}
              aria-describedby={descriptionId}
              min={values.joinedDate || undefined}
              required={officialDateRequired && values.employmentCategory === "OFFICIAL"}
              type="date"
            />
          )}
        </ProfileField>
        {showEmploymentControls ? (
          <>
            <ProfileField
              error={firstError(errors, "employmentStatus")}
              label="Trạng thái việc làm"
            >
              {(descriptionId) => (
                <select {...inputProps("employmentStatus")} aria-describedby={descriptionId}>
                  <option value="ACTIVE">Đang làm</option>
                  <option value="ON_LEAVE">Tạm nghỉ</option>
                </select>
              )}
            </ProfileField>
            <ProfileField
              error={firstError(errors, "effectiveFrom")}
              label="Ngày hiệu lực nếu đổi loại/trạng thái"
            >
              {(descriptionId) => (
                <input
                  {...inputProps("effectiveFrom")}
                  aria-describedby={descriptionId}
                  max={today}
                  type="date"
                />
              )}
            </ProfileField>
          </>
        ) : null}
        {capabilities.canViewSalary ? (
          <ProfileField error={firstError(errors, "baseSalaryAmount")} label="Lương cơ bản (VND)">
            {(descriptionId) => (
              <input
                {...inputProps("baseSalaryAmount")}
                aria-describedby={descriptionId}
                disabled={!capabilities.canEditSalary}
                inputMode="numeric"
                min="0"
                pattern="[0-9]*"
                required={capabilities.canEditSalary}
              />
            )}
          </ProfileField>
        ) : null}
      </div>

      <h3 className="mt-5 font-semibold">B. TikTok và mạng xã hội</h3>
      <div className="mt-3 grid gap-4 md:grid-cols-3">
        <ProfileField error={firstError(errors, "streamingAlias")} label="Tên kênh TikTok / ACC">
          {(descriptionId) => (
            <input {...inputProps("streamingAlias")} aria-describedby={descriptionId} />
          )}
        </ProfileField>
        <ProfileField error={firstError(errors, "tiktokChannelId")} label="ID kênh TikTok">
          {(descriptionId) => (
            <input
              {...inputProps("tiktokChannelId")}
              aria-describedby={descriptionId}
              placeholder="@tenkenh hoặc tenkenh"
            />
          )}
        </ProfileField>
        <ProfileField error={firstError(errors, "facebookUrl")} label="Link Facebook">
          {(descriptionId) => (
            <input {...inputProps("facebookUrl")} aria-describedby={descriptionId} type="url" />
          )}
        </ProfileField>
      </div>

      <h3 className="mt-5 font-semibold">C. Liên hệ và học vấn</h3>
      <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ProfileField error={firstError(errors, "phone")} label="Số điện thoại">
          {(descriptionId) => <input {...inputProps("phone")} aria-describedby={descriptionId} />}
        </ProfileField>
        <ProfileField error={firstError(errors, "email")} label="Email">
          {(descriptionId) => (
            <input {...inputProps("email")} aria-describedby={descriptionId} type="email" />
          )}
        </ProfileField>
        <ProfileField error={firstError(errors, "university")} label="Trường Đại học">
          {(descriptionId) => (
            <input {...inputProps("university")} aria-describedby={descriptionId} />
          )}
        </ProfileField>
        <ProfileField error={firstError(errors, "permanentAddress")} label="Địa chỉ thường trú">
          {(descriptionId) => (
            <textarea
              {...inputProps("permanentAddress")}
              aria-describedby={descriptionId}
              rows={2}
            />
          )}
        </ProfileField>
        <ProfileField error={firstError(errors, "temporaryAddress")} label="Địa chỉ tạm trú">
          {(descriptionId) => (
            <textarea
              {...inputProps("temporaryAddress")}
              aria-describedby={descriptionId}
              rows={2}
            />
          )}
        </ProfileField>
      </div>

      <h3 className="mt-5 font-semibold">D. Ngân hàng và CCCD</h3>
      <div className="mt-3 grid gap-4 md:grid-cols-3">
        <ProfileField error={firstError(errors, "citizenIdNumber")} label="Số CCCD / CMND">
          {(descriptionId) => (
            <input
              {...inputProps("citizenIdNumber")}
              aria-describedby={descriptionId}
              inputMode="numeric"
            />
          )}
        </ProfileField>
        <ProfileField error={firstError(errors, "bankName")} label="Tên ngân hàng">
          {(descriptionId) => (
            <input {...inputProps("bankName")} aria-describedby={descriptionId} />
          )}
        </ProfileField>
        <ProfileField error={firstError(errors, "bankAccountNumber")} label="Số tài khoản">
          {(descriptionId) => (
            <input {...inputProps("bankAccountNumber")} aria-describedby={descriptionId} />
          )}
        </ProfileField>
      </div>
    </>
  );
}
