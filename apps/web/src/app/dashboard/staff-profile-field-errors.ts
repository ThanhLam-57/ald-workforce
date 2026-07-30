import type { StaffProfileFieldErrors } from "./staff-profile-fields";

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : null;
}

function normalizedFieldErrors(value: unknown): StaffProfileFieldErrors {
  const source = record(value);
  if (!source) return {};

  const result: Record<string, readonly string[]> = {};
  for (const [field, messages] of Object.entries(source)) {
    if (!Array.isArray(messages)) continue;
    const strings = messages.filter((message): message is string => typeof message === "string");
    if (strings.length > 0) result[field] = strings;
  }
  return result;
}

export function apiErrorMessage(payload: unknown, fallback: string): string {
  const error = record(record(payload)?.error);
  return typeof error?.message === "string" ? error.message : fallback;
}

export function staffProfileFieldErrorsFrom(
  payload: unknown,
  responseStatus?: number,
): StaffProfileFieldErrors {
  const error = record(record(payload)?.error);
  const fields = record(error?.fields);
  const details = record(error?.details);
  const flattened = normalizedFieldErrors(fields?.fieldErrors);
  const domain = normalizedFieldErrors(details?.fieldErrors);
  const combined = { ...flattened, ...domain };
  const message = typeof error?.message === "string" ? error.message : "";

  if (
    responseStatus === 409 &&
    message.toLocaleLowerCase("vi").includes("mã máy chấm công") &&
    !combined.attendanceMachineCode
  ) {
    return {
      ...combined,
      attendanceMachineCode: [message],
    };
  }
  return combined;
}
