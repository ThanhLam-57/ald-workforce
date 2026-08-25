export const PRIVATE_DOCUMENT_UPLOAD_TIMEOUT_MS = 120_000;
export const PRIVATE_DOCUMENT_MAX_SIZE_BYTES = 8 * 1024 * 1024;
export const PRIVATE_DOCUMENT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type StaffPrivateDocumentKind = "CITIZEN_ID_FRONT" | "CITIZEN_ID_BACK" | "BANK_QR";

type ApiEnvelope<T> = Readonly<{
  data?: T;
  error?: Readonly<{ message?: unknown }>;
}>;

type PrivateDocumentPresignData = Readonly<{
  document: Readonly<{ id: string; version: number }>;
  upload: Readonly<{ url: string; headers: Readonly<Record<string, string>> }>;
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
  const message = payload.error?.message;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}

async function apiEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  const body = await response.text();
  if (!body.trim()) return {};

  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null ? (parsed as ApiEnvelope<T>) : {};
  } catch {
    return {};
  }
}

function responseMessage(
  response: Response,
  payload: ApiEnvelope<unknown>,
  fallback: string,
): string {
  return apiMessage(payload, `${fallback} (HTTP ${response.status}).`);
}

function validPresignData(data: unknown): data is PrivateDocumentPresignData {
  if (typeof data !== "object" || data === null) return false;
  const value = data as {
    document?: { id?: unknown; version?: unknown };
    upload?: { url?: unknown; headers?: unknown };
  };
  return (
    typeof value.document?.id === "string" &&
    typeof value.document.version === "number" &&
    typeof value.upload?.url === "string" &&
    typeof value.upload.headers === "object" &&
    value.upload.headers !== null
  );
}

function assertSameOriginUploadUrl(url: string): void {
  if (url.startsWith("/") && !url.startsWith("//")) return;

  const origin = globalThis.location?.origin;
  if (!origin) {
    throw new Error("API không trả về đường dẫn tải ảnh nội bộ hợp lệ.");
  }

  let uploadUrl: URL;
  try {
    uploadUrl = new URL(url, origin);
  } catch {
    throw new Error("API không trả về đường dẫn tải ảnh nội bộ hợp lệ.");
  }
  if (uploadUrl.origin !== origin) {
    throw new Error("API trả về đường dẫn kho ảnh bên ngoài không còn được hỗ trợ.");
  }
}

export async function uploadStaffPrivateDocument({
  staffId,
  kind,
  file,
  onPhase,
  fetcher = fetch,
}: Readonly<{
  staffId: string;
  kind: StaffPrivateDocumentKind;
  file: File;
  onPhase?: (phase: "PREPARING" | "UPLOADING" | "VERIFYING") => void;
  fetcher?: typeof fetch;
}>): Promise<void> {
  if (!(PRIVATE_DOCUMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.");
  }
  if (file.size < 1 || file.size > PRIVATE_DOCUMENT_MAX_SIZE_BYTES) {
    throw new Error("Mỗi ảnh phải có dung lượng từ 1 byte đến 8 MB.");
  }

  onPhase?.("PREPARING");
  const checksum = await checksumSha256(file);
  const encodedStaffId = encodeURIComponent(staffId);
  const isBankQr = kind === "BANK_QR";
  const presignPath = isBankQr
    ? `/api/staff/${encodedStaffId}/bank-qr/presign`
    : `/api/staff/${encodedStaffId}/identity-documents/presign`;
  let presignResponse: Response;
  try {
    presignResponse = await fetcher(presignPath, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(isBankQr ? {} : { side: kind }),
        originalFileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        checksumSha256: checksum,
      }),
    });
  } catch (error) {
    throw new Error("Không thể kết nối máy chủ để chuẩn bị tải ảnh. Hãy thử lại.", {
      cause: error,
    });
  }
  const presignPayload = await apiEnvelope<PrivateDocumentPresignData>(presignResponse);
  if (!presignResponse.ok) {
    throw new Error(responseMessage(presignResponse, presignPayload, "Không thể chuẩn bị tải ảnh"));
  }
  if (!validPresignData(presignPayload.data)) {
    throw new Error("Phản hồi chuẩn bị tải ảnh không hợp lệ. Hãy thử lại.");
  }
  assertSameOriginUploadUrl(presignPayload.data.upload.url);

  onPhase?.("UPLOADING");
  let uploadResponse: Response;
  try {
    uploadResponse = await putPrivateDocument({
      url: presignPayload.data.upload.url,
      headers: presignPayload.data.upload.headers,
      body: file,
      fetcher,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        `Máy chủ không phản hồi sau ${PRIVATE_DOCUMENT_UPLOAD_TIMEOUT_MS / 1_000} giây. Hãy thử lại.`,
        { cause: error },
      );
    }
    throw new Error("Không thể tải ảnh lên máy chủ. Hãy kiểm tra kết nối và thử lại.", {
      cause: error,
    });
  }
  if (!uploadResponse.ok) {
    const uploadPayload = await apiEnvelope<unknown>(uploadResponse);
    throw new Error(responseMessage(uploadResponse, uploadPayload, "Không thể tải file ảnh"));
  }

  onPhase?.("VERIFYING");
  const documentId = encodeURIComponent(presignPayload.data.document.id);
  const completePath = isBankQr
    ? `/api/staff/${encodedStaffId}/bank-qr/${documentId}/complete`
    : `/api/staff/${encodedStaffId}/identity-documents/${documentId}/complete`;
  let completeResponse: Response;
  try {
    completeResponse = await fetcher(completePath, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: presignPayload.data.document.version }),
    });
  } catch (error) {
    throw new Error(
      "Ảnh đã được tải nhưng máy chủ chưa thể xác minh. Hãy chọn lại file để thử lại.",
      {
        cause: error,
      },
    );
  }
  const completePayload = await apiEnvelope<unknown>(completeResponse);
  if (!completeResponse.ok) {
    throw new Error(
      responseMessage(completeResponse, completePayload, "Không thể xác minh ảnh đã tải"),
    );
  }
}
