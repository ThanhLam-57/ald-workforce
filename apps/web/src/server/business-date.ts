const BUSINESS_TIMEZONE = "Asia/Ho_Chi_Minh";

export function toBusinessDate(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");

  if (!year || !month || !day) {
    throw new Error("Không thể xác định ngày nghiệp vụ.");
  }

  return new Date(`${year}-${month}-${day}T00:00:00.000Z`);
}

export function parseBusinessDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
