import { DomainError } from "@ald/domain";

export const ATTENDANCE_MACHINE_XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const MAX_ATTENDANCE_MACHINE_UPLOAD_BYTES = 20 * 1_024 * 1_024;

export type AttendanceMachineUploadBody = Readonly<{
  body: Uint8Array;
  mimeType: typeof ATTENDANCE_MACHINE_XLSX_MIME_TYPE;
  sizeBytes: number;
}>;

function normalizeMimeType(value: string | null): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function assertSupportedContentEncoding(value: string | null): void {
  if (value === null || value.trim() === "") {
    return;
  }

  const encodings = value
    .split(",")
    .map((encoding) => encoding.trim().toLowerCase())
    .filter(Boolean);

  if (encodings.length === 0 || encodings.every((encoding) => encoding === "identity")) {
    return;
  }

  throw new DomainError(
    "VALIDATION_ERROR",
    "Không hỗ trợ file tải lên có Content-Encoding đã nén.",
    { field: "content-encoding" },
  );
}

function readDeclaredContentLength(value: string | null): number | null {
  if (value === null || value.trim() === "") {
    return null;
  }

  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new DomainError("VALIDATION_ERROR", "Content-Length của file không hợp lệ.", {
      field: "content-length",
    });
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new DomainError("VALIDATION_ERROR", "Content-Length của file không hợp lệ.", {
      field: "content-length",
    });
  }

  return parsed;
}

async function cancelQuietly(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The size validation error below is the useful client-facing error.
  }
}

export async function readAttendanceMachineUploadBody(
  request: Request,
): Promise<AttendanceMachineUploadBody> {
  const mimeType = normalizeMimeType(request.headers.get("content-type"));
  if (mimeType !== ATTENDANCE_MACHINE_XLSX_MIME_TYPE) {
    throw new DomainError("VALIDATION_ERROR", "Chỉ chấp nhận file XLSX có Content-Type hợp lệ.", {
      field: "content-type",
    });
  }

  assertSupportedContentEncoding(request.headers.get("content-encoding"));

  const declaredSize = readDeclaredContentLength(request.headers.get("content-length"));
  if (declaredSize !== null && declaredSize > MAX_ATTENDANCE_MACHINE_UPLOAD_BYTES) {
    throw new DomainError("VALIDATION_ERROR", "File vượt quá 20 MB.", {
      field: "content-length",
      maxBytes: MAX_ATTENDANCE_MACHINE_UPLOAD_BYTES,
    });
  }

  if (request.body === null) {
    throw new DomainError("VALIDATION_ERROR", "File XLSX không được để trống.", {
      field: "body",
    });
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let sizeBytes = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }

      const chunk = result.value;
      if (chunk.byteLength === 0) {
        continue;
      }

      sizeBytes += chunk.byteLength;
      if (sizeBytes > MAX_ATTENDANCE_MACHINE_UPLOAD_BYTES) {
        await cancelQuietly(reader);
        throw new DomainError("VALIDATION_ERROR", "File vượt quá 20 MB.", {
          field: "body",
          maxBytes: MAX_ATTENDANCE_MACHINE_UPLOAD_BYTES,
        });
      }

      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }

    throw new DomainError("VALIDATION_ERROR", "Không thể đọc nội dung file XLSX tải lên.", {
      field: "body",
    });
  } finally {
    reader.releaseLock();
  }

  if (sizeBytes === 0) {
    throw new DomainError("VALIDATION_ERROR", "File XLSX không được để trống.", {
      field: "body",
    });
  }

  const body = new Uint8Array(sizeBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    body,
    mimeType: ATTENDANCE_MACHINE_XLSX_MIME_TYPE,
    sizeBytes,
  };
}
