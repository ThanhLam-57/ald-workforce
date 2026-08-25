import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  deletePrivateObject: vi.fn(async (objectKey: string) => {
    void objectKey;
  }),
  putPrivateObject: vi.fn(async (input: unknown) => {
    void input;
  }),
}));

vi.mock("./object-storage", () => storageMocks);

import {
  cleanupRejectedPrivateObjects,
  STAFF_PRIVATE_DOCUMENT_UPLOAD_TTL_MS,
  storeStaffPrivateDocumentUpload,
} from "./staff-private-document-upload";

const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const checksumSha256 = createHash("sha256").update(imageBytes).digest("base64");
const metadata = {
  requestId: "request-1",
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
} as const;

type PendingDocument = Parameters<typeof storeStaffPrivateDocumentUpload>[0]["document"];

function pendingDocument(overrides: Partial<PendingDocument> = {}): PendingDocument {
  return {
    id: "document-1",
    objectKey: "private/company-1/document-1.png",
    mimeType: "image/png",
    sizeBytes: BigInt(imageBytes.byteLength),
    checksumSha256,
    status: "PENDING_UPLOAD",
    version: 3,
    createdAt: new Date(),
    ...overrides,
  };
}

function uploadRequest(body: Uint8Array = imageBytes): Request {
  return new Request("http://localhost/api/staff/staff-1/documents/document-1/upload", {
    method: "PUT",
    headers: {
      "content-length": String(body.byteLength),
      "content-type": "image/png",
    },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

beforeEach(() => {
  storageMocks.deletePrivateObject.mockReset().mockResolvedValue(undefined);
  storageMocks.putPrivateObject.mockReset().mockResolvedValue(undefined);
  vi.restoreAllMocks();
});

describe("storeStaffPrivateDocumentUpload", () => {
  it.each([
    {
      caseName: "status không còn pending",
      document: pendingDocument({ status: "READY" }),
      expectedVersion: 3,
    },
    {
      caseName: "version đã thay đổi",
      document: pendingDocument({ version: 4 }),
      expectedVersion: 3,
    },
  ])(
    "từ chối khi $caseName trước khi đọc hoặc lưu nội dung",
    async ({ document, expectedVersion }) => {
      const request = uploadRequest();

      await expect(
        storeStaffPrivateDocumentUpload({
          document,
          expectedVersion,
          request,
          metadata,
          event: "staff_document.storage_upload_failed",
        }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: "Yêu cầu tải ảnh đã thay đổi. Vui lòng tải lại thông tin nhân viên.",
      });
      expect(request.bodyUsed).toBe(false);
      expect(storageMocks.putPrivateObject).not.toHaveBeenCalled();
    },
  );

  it("từ chối lượt upload đã hết TTL trước khi đọc hoặc lưu nội dung", async () => {
    const request = uploadRequest();
    const document = pendingDocument({
      createdAt: new Date(Date.now() - STAFF_PRIVATE_DOCUMENT_UPLOAD_TTL_MS - 1),
    });

    await expect(
      storeStaffPrivateDocumentUpload({
        document,
        expectedVersion: document.version,
        request,
        metadata,
        event: "staff_document.storage_upload_failed",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Yêu cầu tải ảnh đã hết hạn. Vui lòng chọn lại file để tạo lượt tải mới.",
    });
    expect(request.bodyUsed).toBe(false);
    expect(storageMocks.putPrivateObject).not.toHaveBeenCalled();
  });

  it("kiểm tra content/checksum rồi lưu đúng bytes và metadata", async () => {
    const document = pendingDocument();

    await expect(
      storeStaffPrivateDocumentUpload({
        document,
        expectedVersion: document.version,
        request: uploadRequest(),
        metadata,
        event: "staff_document.storage_upload_failed",
      }),
    ).resolves.toBeUndefined();
    expect(storageMocks.putPrivateObject).toHaveBeenCalledOnce();
    expect(storageMocks.putPrivateObject).toHaveBeenCalledWith({
      objectKey: document.objectKey,
      mimeType: document.mimeType,
      body: imageBytes,
      checksumSha256,
    });
  });

  it("từ chối checksum không khớp và không ghi object", async () => {
    const document = pendingDocument({
      checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    });

    await expect(
      storeStaffPrivateDocumentUpload({
        document,
        expectedVersion: document.version,
        request: uploadRequest(),
        metadata,
        event: "staff_document.storage_upload_failed",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { field: "body", code: "PRIVATE_DOCUMENT_CHECKSUM_MISMATCH" },
    });
    expect(storageMocks.putPrivateObject).not.toHaveBeenCalled();
  });

  it("map lỗi storage thành dependency unavailable và không log raw provider message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    storageMocks.putPrivateObject.mockRejectedValueOnce(
      Object.assign(new Error("secret provider endpoint"), {
        name: "TimeoutError",
        code: "ETIMEDOUT",
        $metadata: { httpStatusCode: 503 },
      }),
    );
    const document = pendingDocument();

    await expect(
      storeStaffPrivateDocumentUpload({
        document,
        expectedVersion: document.version,
        request: uploadRequest(),
        metadata,
        event: "staff_document.storage_upload_failed",
      }),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      details: { code: "PRIVATE_DOCUMENT_STORAGE_UNAVAILABLE", retryable: true },
    });
    expect(consoleError).toHaveBeenCalledOnce();
    const logged = String(consoleError.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain('"event":"staff_document.storage_upload_failed"');
    expect(logged).toContain('"requestId":"request-1"');
    expect(logged).toContain('"documentId":"document-1"');
    expect(logged).toContain('"errorCode":"ETIMEDOUT"');
    expect(logged).not.toContain("secret provider endpoint");
  });
});

describe("cleanupRejectedPrivateObjects", () => {
  it("best-effort xóa mọi object và chỉ log metadata an toàn khi một lần xóa lỗi", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    storageMocks.deletePrivateObject.mockImplementation(async (objectKey: string) => {
      if (objectKey === "private/rejected-2.png") {
        throw Object.assign(new Error("secret provider endpoint"), {
          name: "ServiceUnavailable",
          code: "SlowDown",
          $metadata: { httpStatusCode: 503 },
        });
      }
    });

    await expect(
      cleanupRejectedPrivateObjects({
        objectKeys: ["private/rejected-1.png", "private/rejected-2.png", "private/rejected-3.png"],
        metadata,
        event: "staff_document.cleanup_failed",
      }),
    ).resolves.toBeUndefined();
    expect(storageMocks.deletePrivateObject).toHaveBeenCalledTimes(3);
    expect(storageMocks.deletePrivateObject).toHaveBeenNthCalledWith(1, "private/rejected-1.png");
    expect(storageMocks.deletePrivateObject).toHaveBeenNthCalledWith(2, "private/rejected-2.png");
    expect(storageMocks.deletePrivateObject).toHaveBeenNthCalledWith(3, "private/rejected-3.png");
    expect(consoleWarn).toHaveBeenCalledOnce();
    const logged = String(consoleWarn.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain('"event":"staff_document.cleanup_failed"');
    expect(logged).toContain('"requestId":"request-1"');
    expect(logged).toContain('"errorName":"ServiceUnavailable"');
    expect(logged).toContain('"errorCode":"SlowDown"');
    expect(logged).toContain('"httpStatusCode":503');
    expect(logged).not.toContain("secret provider endpoint");
  });
});
