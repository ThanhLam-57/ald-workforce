import { DomainError } from "@ald/domain";

export const MAX_STAFF_PRIVATE_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const STAFF_PRIVATE_DOCUMENT_VERSION_HEADER = "x-document-version";

export type StaffPrivateDocumentUploadBody = Readonly<{
  body: Uint8Array;
  mimeType: string;
  sizeBytes: number;
}>;

function normalizeMimeType(value: string | null): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function assertSupportedContentEncoding(value: string | null): void {
  if (value === null || value.trim() === "") return;
  const encodings = value
    .split(",")
    .map((encoding) => encoding.trim().toLowerCase())
    .filter(Boolean);
  if (encodings.length === 0 || encodings.every((encoding) => encoding === "identity")) return;
  throw new DomainError(
    "VALIDATION_ERROR",
    "Không hỗ trợ ảnh tải lên có Content-Encoding đã nén.",
    { field: "content-encoding" },
  );
}

function declaredContentLength(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new DomainError("VALIDATION_ERROR", "Content-Length của ảnh không hợp lệ.", {
      field: "content-length",
    });
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new DomainError("VALIDATION_ERROR", "Content-Length của ảnh không hợp lệ.", {
      field: "content-length",
    });
  }
  return parsed;
}

async function cancelQuietly(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Keep the validation error that caused cancellation.
  }
}

function hasBytes(body: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => body[offset + index] === value);
}

function assertImageSignature(body: Uint8Array, mimeType: string): void {
  const valid =
    (mimeType === "image/jpeg" && hasBytes(body, 0, [0xff, 0xd8, 0xff])) ||
    (mimeType === "image/png" &&
      hasBytes(body, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (mimeType === "image/webp" &&
      hasBytes(body, 0, [0x52, 0x49, 0x46, 0x46]) &&
      hasBytes(body, 8, [0x57, 0x45, 0x42, 0x50]));
  if (!valid) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Nội dung ảnh không khớp định dạng JPEG, PNG hoặc WebP đã khai báo.",
      { field: "body", code: "PRIVATE_DOCUMENT_SIGNATURE_MISMATCH" },
    );
  }
}

export function readStaffPrivateDocumentVersion(request: Request): number {
  const rawVersion = request.headers.get(STAFF_PRIVATE_DOCUMENT_VERSION_HEADER)?.trim() ?? "";
  if (!/^\d+$/.test(rawVersion)) {
    throw new DomainError("VALIDATION_ERROR", "Phiên bản yêu cầu tải ảnh không hợp lệ.", {
      field: STAFF_PRIVATE_DOCUMENT_VERSION_HEADER,
    });
  }
  const version = Number(rawVersion);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new DomainError("VALIDATION_ERROR", "Phiên bản yêu cầu tải ảnh không hợp lệ.", {
      field: STAFF_PRIVATE_DOCUMENT_VERSION_HEADER,
    });
  }
  return version;
}

export async function readStaffPrivateDocumentUploadBody(
  request: Request,
  expected: Readonly<{ mimeType: string; sizeBytes: number }>,
): Promise<StaffPrivateDocumentUploadBody> {
  const mimeType = normalizeMimeType(request.headers.get("content-type"));
  if (mimeType !== expected.mimeType.toLowerCase()) {
    throw new DomainError("VALIDATION_ERROR", "Content-Type của ảnh không khớp yêu cầu tải lên.", {
      field: "content-type",
    });
  }
  assertSupportedContentEncoding(request.headers.get("content-encoding"));

  const declaredSize = declaredContentLength(request.headers.get("content-length"));
  if (declaredSize !== null && declaredSize !== expected.sizeBytes) {
    throw new DomainError("VALIDATION_ERROR", "Dung lượng ảnh không khớp yêu cầu tải lên.", {
      field: "content-length",
      expectedBytes: expected.sizeBytes,
    });
  }
  if (expected.sizeBytes > MAX_STAFF_PRIVATE_DOCUMENT_BYTES) {
    throw new DomainError("VALIDATION_ERROR", "Ảnh vượt quá 8 MB.", {
      maxBytes: MAX_STAFF_PRIVATE_DOCUMENT_BYTES,
    });
  }
  if (request.body === null) {
    throw new DomainError("VALIDATION_ERROR", "Ảnh tải lên không được để trống.", {
      field: "body",
    });
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let sizeBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (result.value.byteLength === 0) continue;
      sizeBytes += result.value.byteLength;
      if (sizeBytes > expected.sizeBytes || sizeBytes > MAX_STAFF_PRIVATE_DOCUMENT_BYTES) {
        await cancelQuietly(reader);
        throw new DomainError("VALIDATION_ERROR", "Dung lượng ảnh không khớp yêu cầu tải lên.", {
          field: "body",
          expectedBytes: expected.sizeBytes,
        });
      }
      chunks.push(result.value);
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("VALIDATION_ERROR", "Không thể đọc nội dung ảnh tải lên.", {
      field: "body",
    });
  } finally {
    reader.releaseLock();
  }

  if (sizeBytes !== expected.sizeBytes) {
    throw new DomainError("VALIDATION_ERROR", "Dung lượng ảnh không khớp yêu cầu tải lên.", {
      field: "body",
      expectedBytes: expected.sizeBytes,
    });
  }

  const body = new Uint8Array(sizeBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  assertImageSignature(body, mimeType);
  return { body, mimeType, sizeBytes };
}
