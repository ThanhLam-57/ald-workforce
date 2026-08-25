import { describe, expect, it } from "vitest";

import type { DomainError } from "@ald/domain";

import {
  EVIDENCE_VERSION_HEADER,
  MAX_EVIDENCE_UPLOAD_BYTES,
  readEvidenceUploadBody,
  readEvidenceVersion,
} from "./evidence-upload-body";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function uploadRequest(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/evidence/evidence-id/upload", {
    method: "PUT",
    headers: {
      "content-type": "image/png",
      [EVIDENCE_VERSION_HEADER]: "1",
      ...headers,
    },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

async function expectValidationError(promise: Promise<unknown>, message: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
    message,
  } satisfies Partial<DomainError>);
}

describe("evidence upload body", () => {
  it("đọc đúng bytes PNG và optimistic-lock version", async () => {
    const request = uploadRequest(PNG, {
      "content-type": "image/png; charset=binary",
      "content-encoding": "identity",
    });
    await expect(
      readEvidenceUploadBody(request, { mimeType: "image/png", sizeBytes: PNG.byteLength }),
    ).resolves.toEqual({ body: PNG, mimeType: "image/png", sizeBytes: PNG.byteLength });
    expect(readEvidenceVersion(request)).toBe(1);
  });

  it("từ chối version thiếu hoặc sai", () => {
    const request = uploadRequest(PNG);
    request.headers.delete(EVIDENCE_VERSION_HEADER);
    expect(() => readEvidenceVersion(request)).toThrow("Phiên bản evidence không hợp lệ.");
  });

  it("từ chối MIME, kích thước và magic bytes không khớp", async () => {
    await expectValidationError(
      readEvidenceUploadBody(uploadRequest(PNG, { "content-type": "image/jpeg" }), {
        mimeType: "image/png",
        sizeBytes: PNG.byteLength,
      }),
      "Content-Type không khớp evidence đã đăng ký.",
    );
    await expectValidationError(
      readEvidenceUploadBody(uploadRequest(PNG), {
        mimeType: "image/png",
        sizeBytes: PNG.byteLength + 1,
      }),
      "Dung lượng evidence không khớp yêu cầu tải lên.",
    );
    await expectValidationError(
      readEvidenceUploadBody(uploadRequest(new Uint8Array(PNG.byteLength)), {
        mimeType: "image/png",
        sizeBytes: PNG.byteLength,
      }),
      "Nội dung file không đúng định dạng ảnh đã khai báo.",
    );
  });

  it("từ chối Content-Encoding nén", async () => {
    await expectValidationError(
      readEvidenceUploadBody(uploadRequest(PNG, { "content-encoding": "gzip" }), {
        mimeType: "image/png",
        sizeBytes: PNG.byteLength,
      }),
      "Không hỗ trợ evidence có Content-Encoding đã nén.",
    );
  });

  it("giới hạn stream thực tế độc lập với Content-Length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_EVIDENCE_UPLOAD_BYTES));
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    await expectValidationError(
      readEvidenceUploadBody(uploadRequest(stream), {
        mimeType: "image/png",
        sizeBytes: MAX_EVIDENCE_UPLOAD_BYTES,
      }),
      "Dung lượng evidence không khớp yêu cầu tải lên.",
    );
  });
});
