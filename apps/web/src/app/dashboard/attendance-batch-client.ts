import type { AttendanceBatchSaveInput } from "@ald/contracts";

export function postAttendanceBatch(
  input: AttendanceBatchSaveInput,
  request: typeof fetch = fetch,
): Promise<Response> {
  return request("/api/attendance/batch", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
