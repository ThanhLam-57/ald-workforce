import { afterEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  deletePrivateObject: vi.fn(async () => undefined),
  putPrivateObject: vi.fn(async () => undefined),
}));

vi.mock("./object-storage", () => storageMocks);

import {
  EVIDENCE_UPLOAD_TTL_MS,
  evidenceStorageUnavailable,
  isEvidenceContentFailure,
  storeEvidenceUpload,
} from "./evidence-upload";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("evidence storage errors", () => {
  it("phân loại metadata mismatch và NotFound là lỗi nội dung", () => {
    expect(
      isEvidenceContentFailure(
        new Error("Metadata evidence trên object storage không khớp yêu cầu đã ký."),
      ),
    ).toBe(true);
    expect(
      isEvidenceContentFailure(Object.assign(new Error("missing"), { name: "NoSuchKey" })),
    ).toBe(true);
    expect(
      isEvidenceContentFailure(
        Object.assign(new Error("missing"), { $metadata: { httpStatusCode: 404 } }),
      ),
    ).toBe(true);
    expect(
      isEvidenceContentFailure(Object.assign(new Error("slow"), { name: "TimeoutError" })),
    ).toBe(false);
  });

  it("trả lỗi 503 retryable và không log raw provider message", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const error = evidenceStorageUnavailable(
        Object.assign(new Error("secret endpoint and provider details"), {
          name: "TimeoutError",
          code: "ETIMEDOUT",
          $metadata: { httpStatusCode: 503 },
        }),
        {
          event: "evidence.storage_verify_failed",
          requestId: "request-1",
          evidenceId: "evidence-1",
        },
      );
      expect(error).toMatchObject({
        code: "DEPENDENCY_UNAVAILABLE",
        details: { code: "EVIDENCE_STORAGE_UNAVAILABLE", retryable: true },
      });
      const logged = String(consoleError.mock.calls[0]?.[0] ?? "");
      expect(logged).toContain('"errorName":"TimeoutError"');
      expect(logged).toContain('"errorCode":"ETIMEDOUT"');
      expect(logged).not.toContain("secret endpoint and provider details");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("từ chối lượt upload quá 5 phút trước khi đọc hoặc ghi object", async () => {
    const now = new Date("2026-08-24T10:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const request = new Request("http://localhost/api/evidence/evidence-1/upload", {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: bytes,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(
      storeEvidenceUpload({
        evidence: {
          id: "evidence-1",
          objectKey: "evidence/expired.png",
          mimeType: "image/png",
          sizeBytes: BigInt(bytes.byteLength),
          checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          status: "PENDING_UPLOAD",
          version: 1,
          createdAt: new Date(now.getTime() - EVIDENCE_UPLOAD_TTL_MS - 1),
        },
        expectedVersion: 1,
        request,
        metadata: {
          requestId: "request-expired",
          ipAddress: "127.0.0.1",
          userAgent: "vitest",
        },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(storageMocks.putPrivateObject).not.toHaveBeenCalled();
  });
});
