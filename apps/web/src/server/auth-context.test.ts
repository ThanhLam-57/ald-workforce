import { beforeEach, describe, expect, it, vi } from "vitest";

const { findManyMock, getSessionMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock("@ald/db", () => ({
  prisma: {
    branchAssignment: {
      findMany: findManyMock,
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("./auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

import { requireActor } from "./auth-context";

describe("requireActor", () => {
  beforeEach(() => {
    findManyMock.mockReset();
    getSessionMock.mockReset();
  });

  it("cho phép API với tài khoản còn cờ đổi mật khẩu", async () => {
    getSessionMock.mockResolvedValue({
      user: {
        id: "user-1",
        companyId: "company-1",
        staffId: null,
        role: "GENERAL_MANAGER",
        active: true,
        banned: false,
        name: "Admin",
        username: "admin",
        mustChangePassword: true,
        twoFactorEnabled: false,
      },
    });
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(requireActor(new Headers())).resolves.toMatchObject({
      userId: "user-1",
      mustChangePassword: true,
    });
    expect(findManyMock).not.toHaveBeenCalled();

    log.mockRestore();
  });
});
