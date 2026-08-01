const STAFF_CODE_PREFIX = "NV";
const LEGACY_STAFF_CODE_PREFIX = "VN";
const MINIMUM_SEQUENCE_WIDTH = 3;
const MAX_STAFF_CODE_LENGTH = 30;

export type StaffCodeSuggestion = Readonly<{
  branchAbbreviation: string;
  suggestedStaffCode: string;
  nextSequence: number;
}>;

export function branchAbbreviationFromCode(branchCode: string): string {
  const normalized = branchCode.trim().toUpperCase();
  const abbreviation = /^([A-Z0-9]+)(?:[_-].*)?$/.exec(normalized)?.[1];
  if (!abbreviation) {
    throw new Error("Không thể tạo viết tắt hợp lệ từ mã cơ sở.");
  }
  return abbreviation;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function nextStaffCodeSequence(
  branchAbbreviation: string,
  existingStaffCodes: readonly string[],
): number {
  const escapedAbbreviation = escapeRegularExpression(branchAbbreviation);
  const pattern = new RegExp(
    `^(?:${STAFF_CODE_PREFIX}|${LEGACY_STAFF_CODE_PREFIX})_${escapedAbbreviation}_(\\d+)$`,
    "i",
  );
  let largestSequence = 0;

  for (const staffCode of existingStaffCodes) {
    const rawSequence = pattern.exec(staffCode.trim())?.[1];
    if (!rawSequence) continue;
    const sequence = Number(rawSequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) continue;
    largestSequence = Math.max(largestSequence, sequence);
  }

  if (largestSequence >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Số thứ tự mã nhân viên đã vượt giới hạn hỗ trợ.");
  }
  return largestSequence + 1;
}

export function formatGeneratedStaffCode(branchAbbreviation: string, sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Số thứ tự mã nhân viên không hợp lệ.");
  }
  const staffCode = `${STAFF_CODE_PREFIX}_${branchAbbreviation}_${String(sequence).padStart(
    MINIMUM_SEQUENCE_WIDTH,
    "0",
  )}`;
  if (staffCode.length > MAX_STAFF_CODE_LENGTH) {
    throw new Error("Mã cơ sở quá dài để tạo mã nhân viên hợp lệ.");
  }
  return staffCode;
}

export function suggestStaffCode(
  branchCode: string,
  existingStaffCodes: readonly string[],
): StaffCodeSuggestion {
  const branchAbbreviation = branchAbbreviationFromCode(branchCode);
  const nextSequence = nextStaffCodeSequence(branchAbbreviation, existingStaffCodes);
  return {
    branchAbbreviation,
    nextSequence,
    suggestedStaffCode: formatGeneratedStaffCode(branchAbbreviation, nextSequence),
  };
}
