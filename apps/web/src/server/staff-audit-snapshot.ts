type StaffAuditSource = Readonly<{
  staffCode: string;
  fullName: string;
  streamingAlias: string | null;
  tiktokChannelId: string | null;
  email: string | null;
  phone: string | null;
  dateOfBirth: Date | null;
  citizenIdNumber: string | null;
  bankAccountNumber: string | null;
  bankName: string | null;
  permanentAddress: string | null;
  temporaryAddress: string | null;
  facebookUrl: string | null;
  university: string | null;
  jobTitle: string;
  baseSalaryAmount: bigint;
  joinedDate: Date | null;
  officialDate: Date | null;
  terminationDate: Date | null;
  employmentCategory: string;
  employmentStatus: string;
  version: number;
  archivedAt?: Date | null;
}>;

type AssignmentAuditSource = Readonly<{
  id: string;
  branchId: string;
  staffId: string;
  assignmentType: string;
  attendanceMachineCode: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  version: number;
  archivedAt?: Date | null;
}>;

function businessDate(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}

function redactedPresence(value: string | null): Readonly<{
  redacted: true;
  present: boolean;
}> {
  return {
    redacted: true,
    present: Boolean(value),
  };
}

/**
 * Snapshot audit đầy đủ cho hồ sơ, nhưng không bao giờ ghi giá trị CCCD hoặc
 * số tài khoản ngân hàng. Object key tài liệu không thuộc shape này.
 */
export function safeStaffAuditSnapshot(staff: StaffAuditSource): Record<string, unknown> {
  return {
    staffCode: staff.staffCode,
    fullName: staff.fullName,
    streamingAlias: staff.streamingAlias,
    tiktokChannelId: staff.tiktokChannelId,
    email: staff.email,
    phone: staff.phone,
    dateOfBirth: businessDate(staff.dateOfBirth),
    citizenIdNumber: redactedPresence(staff.citizenIdNumber),
    bankAccountNumber: redactedPresence(staff.bankAccountNumber),
    bankName: staff.bankName,
    permanentAddress: staff.permanentAddress,
    temporaryAddress: staff.temporaryAddress,
    facebookUrl: staff.facebookUrl,
    university: staff.university,
    jobTitle: staff.jobTitle,
    baseSalaryAmount: staff.baseSalaryAmount.toString(),
    joinedDate: businessDate(staff.joinedDate),
    officialDate: businessDate(staff.officialDate),
    terminationDate: businessDate(staff.terminationDate),
    employmentCategory: staff.employmentCategory,
    employmentStatus: staff.employmentStatus,
    version: staff.version,
    ...(staff.archivedAt !== undefined
      ? { archivedAt: staff.archivedAt?.toISOString() ?? null }
      : {}),
  };
}

export function safeAssignmentAuditSnapshot(
  assignment: AssignmentAuditSource,
): Record<string, unknown> {
  return {
    assignmentId: assignment.id,
    branchId: assignment.branchId,
    staffId: assignment.staffId,
    assignmentType: assignment.assignmentType,
    attendanceMachineCode: assignment.attendanceMachineCode,
    effectiveFrom: businessDate(assignment.effectiveFrom),
    effectiveTo: businessDate(assignment.effectiveTo),
    version: assignment.version,
    ...(assignment.archivedAt !== undefined
      ? { archivedAt: assignment.archivedAt?.toISOString() ?? null }
      : {}),
  };
}
