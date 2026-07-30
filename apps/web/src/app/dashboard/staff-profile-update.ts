import type { BranchStaffDto, StaffProfileUpdateInput } from "@ald/contracts";

export type EditableStaffProfile = Readonly<{
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
  employmentCategory: BranchStaffDto["employmentCategory"];
  baseSalaryAmount: string;
}>;

export type StaffProfileEditCapabilities = Readonly<{
  canEditAssignment: boolean;
  canEditSalary: boolean;
}>;

function nullable(value: string): string | null {
  return value.trim() || null;
}

function normalizedTikTokId(value: string): string | null {
  return value.trim().replace(/^@/, "").toLowerCase() || null;
}

export function createStaffProfileUpdatePayload(
  staff: BranchStaffDto,
  form: EditableStaffProfile,
  capabilities: StaffProfileEditCapabilities = {
    canEditAssignment: true,
    canEditSalary: false,
  },
): StaffProfileUpdateInput {
  const payload: StaffProfileUpdateInput = {
    assignmentId: staff.assignmentId,
    assignmentVersion: staff.assignmentVersion,
    version: staff.version,
  };

  const staffCode = form.staffCode.trim().toUpperCase();
  if (staffCode !== staff.staffCode) payload.staffCode = staffCode;

  if (capabilities.canEditAssignment) {
    const machineCode = form.attendanceMachineCode.trim().toUpperCase();
    if (!machineCode && staff.attendanceMachineCode) {
      throw new Error("Mã máy chấm công của phân công nhân viên không được để trống.");
    }
    if (machineCode && machineCode !== staff.attendanceMachineCode) {
      payload.attendanceMachineCode = machineCode;
    }
  }

  const fullName = form.fullName.trim();
  if (fullName !== staff.fullName) payload.fullName = fullName;

  const optionalFields = [
    ["streamingAlias", nullable(form.streamingAlias), staff.streamingAlias],
    ["phone", nullable(form.phone), staff.phone],
    ["citizenIdNumber", nullable(form.citizenIdNumber), staff.citizenIdNumber],
    ["bankAccountNumber", nullable(form.bankAccountNumber), staff.bankAccountNumber],
    ["bankName", nullable(form.bankName), staff.bankName],
    ["permanentAddress", nullable(form.permanentAddress), staff.permanentAddress],
    ["temporaryAddress", nullable(form.temporaryAddress), staff.temporaryAddress],
    ["facebookUrl", nullable(form.facebookUrl), staff.facebookUrl],
    ["university", nullable(form.university), staff.university],
  ] as const;
  for (const [key, value, previous] of optionalFields) {
    if (value !== previous) payload[key] = value;
  }

  const tiktokChannelId = normalizedTikTokId(form.tiktokChannelId);
  if (tiktokChannelId !== staff.tiktokChannelId) payload.tiktokChannelId = tiktokChannelId;

  const email = nullable(form.email)?.toLowerCase() ?? null;
  if (email !== staff.email) payload.email = email;

  const dateOfBirth = nullable(form.dateOfBirth);
  if (dateOfBirth !== staff.dateOfBirth) payload.dateOfBirth = dateOfBirth;

  const jobTitle = form.jobTitle.trim();
  if (jobTitle !== staff.jobTitle) payload.jobTitle = jobTitle;

  const joinedDate = nullable(form.joinedDate);
  if (joinedDate !== staff.joinedDate) payload.joinedDate = joinedDate;

  const officialDate = nullable(form.officialDate);
  if (officialDate !== staff.officialDate) payload.officialDate = officialDate;

  if (form.employmentCategory !== staff.employmentCategory) {
    payload.employmentCategory = form.employmentCategory;
  }

  if (capabilities.canEditSalary) {
    const baseSalaryAmount = form.baseSalaryAmount.trim() || "0";
    if (baseSalaryAmount !== (staff.baseSalaryAmount ?? "0")) {
      payload.baseSalaryAmount = baseSalaryAmount;
    }
  }

  return payload;
}
