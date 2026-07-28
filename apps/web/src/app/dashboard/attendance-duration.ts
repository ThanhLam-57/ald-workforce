export const MAX_ATTENDANCE_DURATION_MINUTES = 2_880;

export function formatDurationMinutes(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_ATTENDANCE_DURATION_MINUTES) {
    throw new RangeError("Thời lượng phải là số phút nguyên từ 0 đến 2.880.");
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainingMinutes).padStart(2, "0")}`;
}

export function isDurationInputDraft(value: string): boolean {
  if (!/^(?:\d{0,2}|\d{1,2}:\d{0,2})$/.test(value)) return false;

  const [hoursText, minutesText] = value.split(":");
  const hours = Number(hoursText);
  if (hours > 48) return false;

  if (minutesText !== undefined && minutesText.length === 2) {
    const minutes = Number(minutesText);
    if (minutes > 59 || (hours === 48 && minutes > 0)) return false;
  }

  return true;
}

export function parseDurationMinutes(value: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const total = hours * 60 + minutes;
  return total <= MAX_ATTENDANCE_DURATION_MINUTES ? total : null;
}

export function durationInputError(value: string): string | null {
  return parseDurationMinutes(value) === null ? "Nhập thời lượng theo HH:mm, tối đa 48:00." : null;
}
