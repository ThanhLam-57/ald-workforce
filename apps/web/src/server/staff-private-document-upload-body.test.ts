import { describe, expect, it } from "vitest";

import type { DomainError } from "@ald/domain";

import {
  readStaffPrivateDocumentUploadBody,
  readStaffPrivateDocumentVersion,
  STAFF_PRIVATE_DOCUMENT_VERSION_HEADER,
} from "./staff-private-document-upload-body";

function uploadRequest(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/staff/staff-id/identity-documents/document-id/upload", {
    method: "PUT",
    headers: {
      "content-type": "image/png",
      [STAFF_PRIVATE_DOCUMENT_VERSION_HEADER]: "1",
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

describe("staff private document upload body", () => {
  it("reads exact image bytes and the optimistic-lock version", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const request = uploadRequest(bytes, {
      "content-type": "image/png; charset=binary",
      "content-encoding": "identity",
    });
    await expect(
      readStaffPrivateDocumentUploadBody(request, { mimeType: "image/png", sizeBytes: 8 }),
    ).resolves.toEqual({ body: bytes, mimeType: "image/png", sizeBytes: 8 });
    expect(readStaffPrivateDocumentVersion(request)).toBe(1);
  });

  it("rejects a missing version header", () => {
    const request = uploadRequest(new Uint8Array([1]));
    request.headers.delete(STAFF_PRIVATE_DOCUMENT_VERSION_HEADER);
    expect(() => readStaffPrivateDocumentVersion(request)).toThrow(
      "Phiên bản yêu cầu tải ảnh không hợp lệ.",
    );
  });

  it("rejects mismatched MIME and actual size", async () => {
    await expectValidationError(
      readStaffPrivateDocumentUploadBody(
        uploadRequest(new Uint8Array([1]), { "content-type": "image/jpeg" }),
        { mimeType: "image/png", sizeBytes: 1 },
      ),
      "Content-Type của ảnh không khớp yêu cầu tải lên.",
    );
    await expectValidationError(
      readStaffPrivateDocumentUploadBody(uploadRequest(new Uint8Array([1])), {
        mimeType: "image/png",
        sizeBytes: 2,
      }),
      "Dung lượng ảnh không khớp yêu cầu tải lên.",
    );
  });

  it("rejects image bytes that do not match the declared format", async () => {
    await expectValidationError(
      readStaffPrivateDocumentUploadBody(uploadRequest(new Uint8Array([1])), {
        mimeType: "image/png",
        sizeBytes: 1,
      }),
      "Nội dung ảnh không khớp định dạng JPEG, PNG hoặc WebP đã khai báo.",
    );
  });

  it("rejects compressed request bodies", async () => {
    await expectValidationError(
      readStaffPrivateDocumentUploadBody(
        uploadRequest(new Uint8Array([1]), { "content-encoding": "gzip" }),
        { mimeType: "image/png", sizeBytes: 1 },
      ),
      "Không hỗ trợ ảnh tải lên có Content-Encoding đã nén.",
    );
  });
});
