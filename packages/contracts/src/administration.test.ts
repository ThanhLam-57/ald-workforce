import { describe, expect, it } from "vitest";

import {
  adminAssignmentListQuerySchema,
  adminBranchListQuerySchema,
  adminStaffListQuerySchema,
  adminUserListQuerySchema,
} from "./index";

describe("administration list query", () => {
  it("áp dụng page mặc định và chuẩn hóa số từ URL", () => {
    expect(adminBranchListQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 20,
      search: "",
      status: "ALL",
      sort: "code",
      direction: "asc",
    });
    expect(adminStaffListQuerySchema.parse({ page: "2", pageSize: "50" })).toMatchObject({
      page: 2,
      pageSize: 50,
    });
  });

  it("chặn page size vượt giới hạn", () => {
    expect(() => adminUserListQuerySchema.parse({ pageSize: "101" })).toThrow();
  });

  it("chỉ nhận sort và filter trong allow-list", () => {
    expect(() => adminBranchListQuerySchema.parse({ sort: "companyId" })).toThrow();
    expect(() => adminAssignmentListQuerySchema.parse({ status: "DELETED" })).toThrow();
  });
});
