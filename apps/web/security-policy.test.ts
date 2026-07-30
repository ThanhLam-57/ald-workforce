import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy } from "./security-policy";

describe("buildContentSecurityPolicy", () => {
  it("cho phép đúng origin MinIO local khi chạy development", () => {
    const policy = buildContentSecurityPolicy({
      development: true,
      storageEndpoint: "http://127.0.0.1:9000/path-is-ignored",
    });

    expect(policy).toContain(
      "connect-src 'self' https: http://127.0.0.1:9000",
    );
    expect(policy).toContain("img-src 'self' data: blob: https: http://127.0.0.1:9000");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("chỉ cho phép storage HTTPS ở production", () => {
    const policy = buildContentSecurityPolicy({
      development: false,
      storageEndpoint: "https://storage.example.com/private",
    });

    expect(policy).toContain("connect-src 'self' https: https://storage.example.com");
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("không mở CSP cho endpoint HTTP bên ngoài hoặc endpoint sai", () => {
    const externalHttp = buildContentSecurityPolicy({
      development: true,
      storageEndpoint: "http://storage.example.com",
    });
    const invalid = buildContentSecurityPolicy({
      development: true,
      storageEndpoint: "not-a-url",
    });

    expect(externalHttp).not.toContain("http://storage.example.com");
    expect(invalid).toContain("connect-src 'self' https:");
  });
});
