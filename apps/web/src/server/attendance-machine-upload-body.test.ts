import { describe, expect, it } from "vitest";

import type { DomainError } from "@ald/domain";

import {
  ATTENDANCE_MACHINE_XLSX_MIME_TYPE,
  MAX_ATTENDANCE_MACHINE_UPLOAD_BYTES,
  readAttendanceMachineUploadBody,
} from "./attendance-machine-upload-body";

function uploadRequest(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/attendance/machine-imports/job-id/upload", {
    method: "PUT",
    headers: {
      "content-type": ATTENDANCE_MACHINE_XLSX_MIME_TYPE,
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

describe("readAttendanceMachineUploadBody", () => {
  it("reads the actual bytes and normalizes an XLSX MIME type with parameters", async () => {
    const bytes = new Uint8Array([80, 75, 3, 4]);
    const result = await readAttendanceMachineUploadBody(
      uploadRequest(bytes, {
        "content-type": `${ATTENDANCE_MACHINE_XLSX_MIME_TYPE}; charset=binary`,
        "content-encoding": " Identity ",
        "content-length": "1",
      }),
    );

    expect(result).toEqual({
      body: bytes,
      mimeType: ATTENDANCE_MACHINE_XLSX_MIME_TYPE,
      sizeBytes: 4,
    });
  });

  it("rejects an empty request body", async () => {
    await expectValidationError(
      readAttendanceMachineUploadBody(uploadRequest(null)),
      "File XLSX không được để trống.",
    );
  });

  it("rejects the wrong MIME type", async () => {
    await expectValidationError(
      readAttendanceMachineUploadBody(
        uploadRequest(new Uint8Array([1]), { "content-type": "application/octet-stream" }),
      ),
      "Chỉ chấp nhận file XLSX có Content-Type hợp lệ.",
    );
  });

  it("rejects compressed request bodies", async () => {
    await expectValidationError(
      readAttendanceMachineUploadBody(
        uploadRequest(new Uint8Array([1]), { "content-encoding": "gzip" }),
      ),
      "Không hỗ trợ file tải lên có Content-Encoding đã nén.",
    );
  });

  it("rejects a declared size above the limit before reading the body", async () => {
    await expectValidationError(
      readAttendanceMachineUploadBody(
        uploadRequest(new Uint8Array([1]), {
          "content-length": String(MAX_ATTENDANCE_MACHINE_UPLOAD_BYTES + 1),
        }),
      ),
      "File vượt quá 20 MB.",
    );
  });

  it("counts actual stream bytes so a false small Content-Length cannot bypass the limit", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_ATTENDANCE_MACHINE_UPLOAD_BYTES));
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });

    await expectValidationError(
      readAttendanceMachineUploadBody(uploadRequest(stream, { "content-length": "1" })),
      "File vượt quá 20 MB.",
    );
  });

  it("rejects a malformed Content-Length", async () => {
    await expectValidationError(
      readAttendanceMachineUploadBody(
        uploadRequest(new Uint8Array([1]), { "content-length": "not-a-number" }),
      ),
      "Content-Length của file không hợp lệ.",
    );
  });
});
