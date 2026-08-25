import { createHash } from "node:crypto";

import { DomainError } from "@ald/domain";

import { deletePrivateObject, putPrivateObject } from "./object-storage";
import type { RequestMetadata } from "./request-metadata";
import { readStaffPrivateDocumentUploadBody } from "./staff-private-document-upload-body";

type PendingPrivateDocument = Readonly<{
  id: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: bigint;
  checksumSha256: string;
  status: string;
  version: number;
  createdAt: Date;
}>;

export const STAFF_PRIVATE_DOCUMENT_UPLOAD_TTL_MS = 5 * 60_000;

type StorageServiceError = Readonly<{
  name?: unknown;
  message?: unknown;
  code?: unknown;
  $metadata?: Readonly<{ httpStatusCode?: unknown }>;
}>;

export function isPrivateDocumentContentFailure(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  if (cause.message === "Metadata evidence trên object storage không khớp yêu cầu đã ký.") {
    return true;
  }
  const storageError = cause as StorageServiceError;
  const status = storageError.$metadata?.httpStatusCode;
  return status === 404 || cause.name === "NotFound" || cause.name === "NoSuchKey";
}

export function privateDocumentStorageUnavailable(
  cause: unknown,
  input: Readonly<{
    event: string;
    requestId: string;
    documentId: string;
  }>,
): DomainError {
  const storageError =
    cause !== null && typeof cause === "object" ? (cause as StorageServiceError) : null;
  console.error(
    JSON.stringify({
      event: input.event,
      requestId: input.requestId,
      documentId: input.documentId,
      errorName: cause instanceof Error ? cause.name : "UnknownError",
      errorCode: typeof storageError?.code === "string" ? storageError.code : null,
      httpStatusCode:
        typeof storageError?.$metadata?.httpStatusCode === "number"
          ? storageError.$metadata.httpStatusCode
          : null,
    }),
  );
  return new DomainError(
    "DEPENDENCY_UNAVAILABLE",
    "Kho lưu trữ ảnh đang tạm thời không khả dụng. Vui lòng thử lại.",
    { code: "PRIVATE_DOCUMENT_STORAGE_UNAVAILABLE", retryable: true },
  );
}

export async function cleanupRejectedPrivateObjects(
  input: Readonly<{
    objectKeys: readonly string[];
    metadata: RequestMetadata;
    event: string;
  }>,
): Promise<void> {
  await Promise.all(
    input.objectKeys.map(async (objectKey) => {
      try {
        await deletePrivateObject(objectKey);
      } catch (cause) {
        const storageError =
          cause !== null && typeof cause === "object" ? (cause as StorageServiceError) : null;
        console.warn(
          JSON.stringify({
            event: input.event,
            requestId: input.metadata.requestId,
            errorName: cause instanceof Error ? cause.name : "UnknownError",
            errorCode: typeof storageError?.code === "string" ? storageError.code : null,
            httpStatusCode:
              typeof storageError?.$metadata?.httpStatusCode === "number"
                ? storageError.$metadata.httpStatusCode
                : null,
          }),
        );
      }
    }),
  );
}

export async function storeStaffPrivateDocumentUpload(
  input: Readonly<{
    document: PendingPrivateDocument;
    expectedVersion: number;
    request: Request;
    metadata: RequestMetadata;
    event: string;
  }>,
): Promise<void> {
  if (
    input.document.status !== "PENDING_UPLOAD" ||
    input.document.version !== input.expectedVersion
  ) {
    throw new DomainError(
      "CONFLICT",
      "Yêu cầu tải ảnh đã thay đổi. Vui lòng tải lại thông tin nhân viên.",
    );
  }
  if (Date.now() - input.document.createdAt.getTime() > STAFF_PRIVATE_DOCUMENT_UPLOAD_TTL_MS) {
    throw new DomainError(
      "CONFLICT",
      "Yêu cầu tải ảnh đã hết hạn. Vui lòng chọn lại file để tạo lượt tải mới.",
    );
  }

  const expectedSize = Number(input.document.sizeBytes);
  const upload = await readStaffPrivateDocumentUploadBody(input.request, {
    mimeType: input.document.mimeType,
    sizeBytes: expectedSize,
  });
  const checksumSha256 = createHash("sha256").update(upload.body).digest("base64");
  if (checksumSha256 !== input.document.checksumSha256) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Checksum ảnh không khớp file đã đăng ký. Hãy chọn lại ảnh và thử lại.",
      { field: "body", code: "PRIVATE_DOCUMENT_CHECKSUM_MISMATCH" },
    );
  }

  try {
    await putPrivateObject({
      objectKey: input.document.objectKey,
      mimeType: upload.mimeType,
      body: upload.body,
      checksumSha256,
    });
  } catch (cause) {
    throw privateDocumentStorageUnavailable(cause, {
      event: input.event,
      requestId: input.metadata.requestId,
      documentId: input.document.id,
    });
  }
}
