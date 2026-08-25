import { createHash } from "node:crypto";

import { DomainError } from "@ald/domain";

import { readEvidenceUploadBody } from "./evidence-upload-body";
import { deletePrivateObject, putPrivateObject } from "./object-storage";
import type { RequestMetadata } from "./request-metadata";

type PendingEvidence = Readonly<{
  id: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: bigint;
  checksumSha256: string;
  status: string;
  version: number;
  createdAt: Date;
}>;

export const EVIDENCE_UPLOAD_TTL_MS = 5 * 60_000;

type StorageServiceError = Readonly<{
  code?: unknown;
  $metadata?: Readonly<{ httpStatusCode?: unknown }>;
}>;

const EVIDENCE_METADATA_MISMATCH_MESSAGE =
  "Metadata evidence trên object storage không khớp yêu cầu đã ký.";

export function isEvidenceContentFailure(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  if (cause.message === EVIDENCE_METADATA_MISMATCH_MESSAGE) return true;
  const storageError = cause as StorageServiceError;
  const status = storageError.$metadata?.httpStatusCode;
  return status === 404 || cause.name === "NotFound" || cause.name === "NoSuchKey";
}

export function evidenceStorageUnavailable(
  cause: unknown,
  input: Readonly<{
    event: string;
    requestId: string;
    evidenceId: string;
  }>,
): DomainError {
  const storageError =
    cause !== null && typeof cause === "object" ? (cause as StorageServiceError) : null;
  console.error(
    JSON.stringify({
      event: input.event,
      requestId: input.requestId,
      evidenceId: input.evidenceId,
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
    "Kho lưu trữ evidence đang tạm thời không khả dụng. Vui lòng thử lại.",
    { code: "EVIDENCE_STORAGE_UNAVAILABLE", retryable: true },
  );
}

export async function cleanupRejectedEvidenceObjects(
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

export async function storeEvidenceUpload(
  input: Readonly<{
    evidence: PendingEvidence;
    expectedVersion: number;
    request: Request;
    metadata: RequestMetadata;
  }>,
): Promise<void> {
  if (
    input.evidence.status !== "PENDING_UPLOAD" ||
    input.evidence.version !== input.expectedVersion
  ) {
    throw new DomainError("CONFLICT", "Evidence không còn chờ upload.");
  }
  if (Date.now() - input.evidence.createdAt.getTime() > EVIDENCE_UPLOAD_TTL_MS) {
    throw new DomainError(
      "CONFLICT",
      "Yêu cầu tải evidence đã hết hạn. Vui lòng chọn lại file để tạo lượt tải mới.",
    );
  }

  const upload = await readEvidenceUploadBody(input.request, {
    mimeType: input.evidence.mimeType,
    sizeBytes: Number(input.evidence.sizeBytes),
  });
  const checksumSha256 = createHash("sha256").update(upload.body).digest("base64");
  if (checksumSha256 !== input.evidence.checksumSha256) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Checksum evidence không khớp file đã đăng ký. Hãy chọn lại ảnh và thử lại.",
      { field: "body", code: "EVIDENCE_CHECKSUM_MISMATCH" },
    );
  }

  try {
    await putPrivateObject({
      objectKey: input.evidence.objectKey,
      mimeType: upload.mimeType,
      body: upload.body,
      checksumSha256,
    });
  } catch (cause) {
    throw evidenceStorageUnavailable(cause, {
      event: "evidence.storage_upload_failed",
      requestId: input.metadata.requestId,
      evidenceId: input.evidence.id,
    });
  }
}
