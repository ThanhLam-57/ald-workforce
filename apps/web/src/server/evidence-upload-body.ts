import { DomainError } from "@ald/domain";

export const MAX_EVIDENCE_UPLOAD_BYTES = 10 * 1_024 * 1_024;
export const EVIDENCE_VERSION_HEADER = "x-evidence-version";

const EVIDENCE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type EvidenceUploadMimeType = (typeof EVIDENCE_MIME_TYPES)[number];

export type EvidenceUploadBody = Readonly<{
  body: Uint8Array;
  mimeType: EvidenceUploadMimeType;
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
  throw new DomainError("VALIDATION_ERROR", "Không hỗ trợ evidence có Content-Encoding đã nén.", {
    field: "content-encoding",
  });
}

function declaredContentLength(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new DomainError("VALIDATION_ERROR", "Content-Length của evidence không hợp lệ.", {
      field: "content-length",
    });
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new DomainError("VALIDATION_ERROR", "Content-Length của evidence không hợp lệ.", {
      field: "content-length",
    });
  }
  return parsed;
}

async function cancelQuietly(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Preserve the validation error that caused cancellation.
  }
}

function bytesEqual(body: Uint8Array, offset: number, signature: readonly number[]): boolean {
  return signature.every((byte, index) => body[offset + index] === byte);
}

function hasExpectedImageSignature(body: Uint8Array, mimeType: EvidenceUploadMimeType): boolean {
  if (mimeType === "image/jpeg") {
    return body.length >= 3 && bytesEqual(body, 0, [0xff, 0xd8, 0xff]);
  }
  if (mimeType === "image/png") {
    return (
      body.length >= 8 && bytesEqual(body, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  }
  return (
    body.length >= 12 &&
    bytesEqual(body, 0, [0x52, 0x49, 0x46, 0x46]) &&
    bytesEqual(body, 8, [0x57, 0x45, 0x42, 0x50])
  );
}

export function readEvidenceVersion(request: Request): number {
  const rawVersion = request.headers.get(EVIDENCE_VERSION_HEADER)?.trim() ?? "";
  if (!/^\d+$/.test(rawVersion)) {
    throw new DomainError("VALIDATION_ERROR", "Phiên bản evidence không hợp lệ.", {
      field: EVIDENCE_VERSION_HEADER,
    });
  }
  const version = Number(rawVersion);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new DomainError("VALIDATION_ERROR", "Phiên bản evidence không hợp lệ.", {
      field: EVIDENCE_VERSION_HEADER,
    });
  }
  return version;
}

export async function readEvidenceUploadBody(
  request: Request,
  expected: Readonly<{ mimeType: string; sizeBytes: number }>,
): Promise<EvidenceUploadBody> {
  const mimeType = normalizeMimeType(request.headers.get("content-type"));
  if (!(EVIDENCE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw new DomainError("VALIDATION_ERROR", "Chỉ chấp nhận evidence JPEG, PNG hoặc WebP.", {
      field: "content-type",
    });
  }
  if (mimeType !== expected.mimeType.toLowerCase()) {
    throw new DomainError("VALIDATION_ERROR", "Content-Type không khớp evidence đã đăng ký.", {
      field: "content-type",
    });
  }
  assertSupportedContentEncoding(request.headers.get("content-encoding"));

  if (
    !Number.isSafeInteger(expected.sizeBytes) ||
    expected.sizeBytes < 1 ||
    expected.sizeBytes > MAX_EVIDENCE_UPLOAD_BYTES
  ) {
    throw new DomainError("VALIDATION_ERROR", "Dung lượng evidence đã đăng ký không hợp lệ.");
  }

  const declaredSize = declaredContentLength(request.headers.get("content-length"));
  if (declaredSize !== null && declaredSize !== expected.sizeBytes) {
    throw new DomainError("VALIDATION_ERROR", "Dung lượng evidence không khớp yêu cầu tải lên.", {
      field: "content-length",
      expectedBytes: expected.sizeBytes,
    });
  }
  if (request.body === null) {
    throw new DomainError("VALIDATION_ERROR", "Evidence tải lên không được để trống.", {
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
      if (sizeBytes > expected.sizeBytes || sizeBytes > MAX_EVIDENCE_UPLOAD_BYTES) {
        await cancelQuietly(reader);
        throw new DomainError(
          "VALIDATION_ERROR",
          "Dung lượng evidence không khớp yêu cầu tải lên.",
          { field: "body", expectedBytes: expected.sizeBytes },
        );
      }
      chunks.push(result.value);
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("VALIDATION_ERROR", "Không thể đọc nội dung evidence tải lên.", {
      field: "body",
    });
  } finally {
    reader.releaseLock();
  }

  if (sizeBytes !== expected.sizeBytes) {
    throw new DomainError("VALIDATION_ERROR", "Dung lượng evidence không khớp yêu cầu tải lên.", {
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

  const typedMimeType = mimeType as EvidenceUploadMimeType;
  if (!hasExpectedImageSignature(body, typedMimeType)) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Nội dung file không đúng định dạng ảnh đã khai báo.",
      { field: "body", code: "EVIDENCE_FILE_SIGNATURE_MISMATCH" },
    );
  }

  return { body, mimeType: typedMimeType, sizeBytes };
}
