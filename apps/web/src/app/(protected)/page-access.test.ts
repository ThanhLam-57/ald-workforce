import type { ActorContext } from "@ald/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOptionalActorMock, redirectMock } = vi.hoisted(() => ({
  getOptionalActorMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/server/auth-context", () => ({
  getOptionalActor: getOptionalActorMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import { requirePageActor } from "./page-access";

const actor: ActorContext = {
  userId: "user-1",
  companyId: "company-1",
  staffId: null,
  role: "GENERAL_MANAGER",
  activeBranchIds: [],
  mustChangePassword: true,
};

describe("requirePageActor", () => {
  beforeEach(() => {
    getOptionalActorMock.mockReset();
    redirectMock.mockClear();
  });

  it("cho phép tài khoản mang cờ đổi mật khẩu mở trang đúng quyền", async () => {
    getOptionalActorMock.mockResolvedValue(actor);

    await expect(requirePageActor(["GENERAL_MANAGER"])).resolves.toBe(actor);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("vẫn chuyển người chưa đăng nhập về trang đăng nhập", async () => {
    getOptionalActorMock.mockResolvedValue(null);

    await expect(requirePageActor(["GENERAL_MANAGER"])).rejects.toThrow("REDIRECT:/login");
  });

  it("vẫn chặn vai trò không được phép", async () => {
    getOptionalActorMock.mockResolvedValue(actor);

    await expect(requirePageActor(["TRAINING_MANAGER"])).rejects.toThrow("REDIRECT:/forbidden");
  });
});
