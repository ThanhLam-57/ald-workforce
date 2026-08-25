import { describe, expect, it, vi } from "vitest";

import {
  PRIVATE_DOCUMENT_MAX_SIZE_BYTES,
  putPrivateDocument,
  uploadStaffPrivateDocument,
} from "./private-document-upload";

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function presignResponse(input: {
  documentId: string;
  uploadPath: string;
  version?: number;
}): Response {
  const version = input.version ?? 1;
  return jsonResponse(
    {
      data: {
        document: { id: input.documentId, version },
        upload: {
          url: input.uploadPath,
          headers: {
            "Content-Type": "image/png",
            "X-Document-Version": String(version),
          },
        },
      },
    },
    201,
  );
}

describe("putPrivateDocument", () => {
  it("gửi đúng PUT, headers và body tới API cùng origin", async () => {
    const file = new Blob(["image"], { type: "image/png" });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));

    const response = await putPrivateDocument({
      url: "/api/staff/staff-1/identity-documents/document-1/upload",
      headers: { "Content-Type": "image/png", "X-Document-Version": "3" },
      body: file,
      fetcher,
    });

    expect(response.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/staff/staff-1/identity-documents/document-1/upload",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "image/png", "X-Document-Version": "3" },
        body: file,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("hủy request bị treo khi hết thời gian", async () => {
    const fetcher = vi.fn<typeof fetch>((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });

    await expect(
      putPrivateDocument({
        url: "/api/staff/staff-1/identity-documents/document-1/upload",
        headers: {},
        body: new Blob(["image"]),
        timeoutMs: 1,
        fetcher,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("uploadStaffPrivateDocument", () => {
  it("chặn MIME không hỗ trợ, file rỗng và file quá 8 MB trước khi gọi API", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      uploadStaffPrivateDocument({
        staffId: "staff-1",
        kind: "CITIZEN_ID_FRONT",
        file: new File(["text"], "front.txt", { type: "text/plain" }),
        fetcher,
      }),
    ).rejects.toThrow("Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.");
    await expect(
      uploadStaffPrivateDocument({
        staffId: "staff-1",
        kind: "CITIZEN_ID_FRONT",
        file: new File([], "empty.png", { type: "image/png" }),
        fetcher,
      }),
    ).rejects.toThrow("Mỗi ảnh phải có dung lượng từ 1 byte đến 8 MB.");
    await expect(
      uploadStaffPrivateDocument({
        staffId: "staff-1",
        kind: "BANK_QR",
        file: new File([new Uint8Array(PRIVATE_DOCUMENT_MAX_SIZE_BYTES + 1)], "large.png", {
          type: "image/png",
        }),
        fetcher,
      }),
    ).rejects.toThrow("Mỗi ảnh phải có dung lượng từ 1 byte đến 8 MB.");

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("tải CCCD qua URL cùng origin và giữ nguyên headers/version do API cấp", async () => {
    const phases: string[] = [];
    const file = new File(["front-image"], "front.png", { type: "image/png" });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        presignResponse({
          documentId: "document/front",
          uploadPath: "/api/staff/staff%2F1/identity-documents/document%2Ffront/upload",
          version: 7,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { status: "UPLOADED" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: "READY" } }));

    await uploadStaffPrivateDocument({
      staffId: "staff/1",
      kind: "CITIZEN_ID_FRONT",
      file,
      fetcher,
      onPhase: (phase) => phases.push(phase),
    });

    expect(phases).toEqual(["PREPARING", "UPLOADING", "VERIFYING"]);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/staff/staff%2F1/identity-documents/presign",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/staff/staff%2F1/identity-documents/document%2Ffront/upload",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "image/png", "X-Document-Version": "7" },
        body: file,
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "/api/staff/staff%2F1/identity-documents/document%2Ffront/complete",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ version: 7 }),
      }),
    );

    const presignBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(presignBody).toMatchObject({
      side: "CITIZEN_ID_FRONT",
      originalFileName: "front.png",
      mimeType: "image/png",
      sizeBytes: file.size,
    });
    expect(presignBody.checksumSha256).toEqual(expect.any(String));
  });

  it("dùng đúng API bank-qr cho ảnh QR ngân hàng", async () => {
    const file = new File(["qr-image"], "qr.png", { type: "image/png" });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        presignResponse({
          documentId: "bank-document",
          uploadPath: "/api/staff/staff-1/bank-qr/bank-document/upload",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { status: "UPLOADED" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: "READY" } }));

    await uploadStaffPrivateDocument({
      staffId: "staff-1",
      kind: "BANK_QR",
      file,
      fetcher,
    });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/staff/staff-1/bank-qr/presign",
      "/api/staff/staff-1/bank-qr/bank-document/upload",
      "/api/staff/staff-1/bank-qr/bank-document/complete",
    ]);
    const presignBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(presignBody).not.toHaveProperty("side");
  });

  it("không lỗi JSON khi API trả trang HTML và hiển thị HTTP status", async () => {
    const file = new File(["image"], "front.png", { type: "image/png" });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("<!DOCTYPE html><title>Internal error</title>", { status: 500 }),
      );

    await expect(
      uploadStaffPrivateDocument({
        staffId: "staff-1",
        kind: "CITIZEN_ID_FRONT",
        file,
        fetcher,
      }),
    ).rejects.toThrow("Không thể chuẩn bị tải ảnh (HTTP 500).");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("hiển thị lỗi API upload và lần thử sau dùng lượt chuẩn bị mới", async () => {
    const file = new File(["image"], "front.png", { type: "image/png" });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        presignResponse({
          documentId: "failed-document",
          uploadPath: "/api/staff/staff-1/identity-documents/failed-document/upload",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "Kho ảnh đang tạm thời không khả dụng." } }, 503),
      )
      .mockResolvedValueOnce(
        presignResponse({
          documentId: "retry-document",
          uploadPath: "/api/staff/staff-1/identity-documents/retry-document/upload",
          version: 2,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { status: "UPLOADED" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: "READY" } }));

    await expect(
      uploadStaffPrivateDocument({
        staffId: "staff-1",
        kind: "CITIZEN_ID_FRONT",
        file,
        fetcher,
      }),
    ).rejects.toThrow("Kho ảnh đang tạm thời không khả dụng.");

    await expect(
      uploadStaffPrivateDocument({
        staffId: "staff-1",
        kind: "CITIZEN_ID_FRONT",
        file,
        fetcher,
      }),
    ).resolves.toBeUndefined();

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/staff/staff-1/identity-documents/presign",
      "/api/staff/staff-1/identity-documents/failed-document/upload",
      "/api/staff/staff-1/identity-documents/presign",
      "/api/staff/staff-1/identity-documents/retry-document/upload",
      "/api/staff/staff-1/identity-documents/retry-document/complete",
    ]);
  });

  it("từ chối URL upload khác origin để không quay lại PUT thẳng lên bucket", async () => {
    const file = new File(["image"], "front.png", { type: "image/png" });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      presignResponse({
        documentId: "document-1",
        uploadPath: "https://storage.railway.app/private/object?signature=test",
      }),
    );

    await expect(
      uploadStaffPrivateDocument({
        staffId: "staff-1",
        kind: "CITIZEN_ID_FRONT",
        file,
        fetcher,
      }),
    ).rejects.toThrow("API không trả về đường dẫn tải ảnh nội bộ hợp lệ.");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
