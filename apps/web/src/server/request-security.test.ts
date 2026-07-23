import { afterEach, describe, expect, it } from "vitest";

import { isTrustedMutationRequest } from "./request-security";

const originalUrl = process.env.BETTER_AUTH_URL;

afterEach(() => {
  process.env.BETTER_AUTH_URL = originalUrl;
  delete process.env.TRUSTED_ORIGINS;
});

describe("isTrustedMutationRequest", () => {
  it("allows safe methods", () => {
    expect(isTrustedMutationRequest(new Request("https://app.test/api/staff"))).toBe(true);
  });

  it("allows a mutation from the configured application origin", () => {
    process.env.BETTER_AUTH_URL = "https://app.test";
    const request = new Request("https://app.test/api/staff", {
      method: "POST",
      headers: {
        origin: "https://app.test",
        "sec-fetch-site": "same-origin",
      },
    });
    expect(isTrustedMutationRequest(request)).toBe(true);
  });

  it("rejects cross-site and untrusted origins", () => {
    process.env.BETTER_AUTH_URL = "https://app.test";
    const request = new Request("https://app.test/api/staff", {
      method: "POST",
      headers: {
        origin: "https://evil.test",
        "sec-fetch-site": "cross-site",
      },
    });
    expect(isTrustedMutationRequest(request)).toBe(false);
  });
});
