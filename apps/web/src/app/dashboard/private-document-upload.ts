export const PRIVATE_DOCUMENT_UPLOAD_TIMEOUT_MS = 30_000;
export const PRIVATE_DOCUMENT_MAX_SIZE_BYTES = 8 * 1024 * 1024;
export const PRIVATE_DOCUMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type StaffPrivateDocumentKind =
  | "CITIZEN_ID_FRONT"
  | "CITIZEN_ID_BACK"
  | "BANK_QR";

type ApiEnvelope<T> = Readonly<{
  data?: T;
  error?: Readonly<{ message?: unknown }>;
}>;

type UploadPrivateDocumentInput = Readonly<{
  url: string;
  headers: Readonly<Record<string, string>>;
  body: BodyInit;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}>;

export async function putPrivateDocument({
  url,
  headers,
  body,
  timeoutMs = PRIVATE_DOCUMENT_UPLOAD_TIMEOUT_MS,
  fetcher = fetch,
}: UploadPrivateDocumentInput): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetcher(url, {
      method: "PUT",
      headers,
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function checksumSha256(file: File): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function apiMessage(payload: ApiEnvelope<unknown>, fallback: string): string {
  return typeof payload.error?.message === "string" ? payload.error.message : fallback;
}

export async function uploadStaffPrivateDocument({
  staffId,
  kind,
  file,
  onPhase,
}: Readonly<{
  staffId: string;
  kind: StaffPrivateDocumentKind;
  file: File;
  onPhase?: (phase: "PREPARING" | "UPLOADING" | "VERIFYING") => void;
}>): Promise<void> {
  if (!(PRIVATE_DOCUMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.");
  }
  if (file.size > PRIVATE_DOCUMENT_MAX_SIZE_BYTES) {
    throw new Error("Mỗi ảnh không được lớn hơn 8 MB.");
  }

  onPhase?.("PREPARING");
  const checksum = await checksumSha256(file);
  const encodedStaffId = encodeURIComponent(staffId);
  const isBankQr = kind === "BANK_QR";
  const presignPath = isBankQr
    ? `/api/staff/${encodedStaffId}/bank-qr/presign`
    : `/api/staff/${encodedStaffId}/identity-documents/presign`;
  const presignResponse = await fetch(presignPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(isBankQr ? {} : { side: kind }),
      originalFileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      checksumSha256: checksum,
    }),
  });
  const presignPayload = (await presignResponse.json()) as ApiEnvelope<{
    document: Readonly<{ id: string; version: number }>;
    upload: Readonly<{ url: string; headers: Readonly<Record<string, string>> }>;
  }>;
  if (!presignResponse.ok || !presignPayload.data) {
    throw new Error(apiMessage(presignPayload, "Không thể chuẩn bị tải ảnh."));
  }

  onPhase?.("UPLOADING");
  let uploadResponse: Response;
  try {
    uploadResponse = await putPrivateDocument({
      url: presignPayload.data.upload.url,
      headers: presignPayload.data.upload.headers,
      body: file,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        `Kho ảnh không phản hồi sau ${PRIVATE_DOCUMENT_UPLOAD_TIMEOUT_MS / 1_000} giây.`,
        { cause: error },
      );
    }
    throw new Error("Không thể kết nối kho ảnh. Hãy kiểm tra cấu hình lưu trữ.", {
      cause: error,
    });
  }
  if (!uploadResponse.ok) {
    throw new Error("Kho lưu trữ từ chối file ảnh.");
  }

  onPhase?.("VERIFYING");
  const documentId = encodeURIComponent(presignPayload.data.document.id);
  const completePath = isBankQr
    ? `/api/staff/${encodedStaffId}/bank-qr/${documentId}/complete`
    : `/api/staff/${encodedStaffId}/identity-documents/${documentId}/complete`;
  const completeResponse = await fetch(completePath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: presignPayload.data.document.version }),
  });
  const completePayload = (await completeResponse.json()) as ApiEnvelope<unknown>;
  if (!completeResponse.ok) {
    throw new Error(apiMessage(completePayload, "Không thể xác minh ảnh đã tải."));
  }
}
