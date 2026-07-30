import { describe, expect, it, vi } from "vitest";

import { putPrivateDocument } from "./private-document-upload";

describe("putPrivateDocument", () => {
  it("gửi đúng PUT, headers và body tới signed URL", async () => {
    const file = new Blob(["image"], { type: "image/png" });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));

    const response = await putPrivateDocument({
      url: "http://127.0.0.1:9000/bucket/object?signature=test",
      headers: { "Content-Type": "image/png" },
      body: file,
      fetcher,
    });

    expect(response.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:9000/bucket/object?signature=test",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "image/png" },
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
        url: "http://127.0.0.1:9000/bucket/object",
        headers: {},
        body: new Blob(["image"]),
        timeoutMs: 1,
        fetcher,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
