import { describe, expect, it } from "vitest";

import { passwordChangeSchema, userCreateSchema } from "./index";

describe("password policy", () => {
  it("rejects weak account provisioning passwords", () => {
    expect(
      userCreateSchema.safeParse({
        email: "user@example.com",
        username: "user",
        password: "alllowercase123",
        name: "User",
        role: "LIVE_EMPLOYEE",
      }).success,
    ).toBe(false);
  });

  it("requires a strong password different from the current password", () => {
    const password = "Strong-Password-123!";
    expect(
      passwordChangeSchema.safeParse({
        currentPassword: password,
        newPassword: password,
      }).success,
    ).toBe(false);
    expect(
      passwordChangeSchema.safeParse({
        currentPassword: password,
        newPassword: "Different-Password-456!",
      }).success,
    ).toBe(true);
  });
});
