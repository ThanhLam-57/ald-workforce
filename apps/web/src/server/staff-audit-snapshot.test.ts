import { describe, expect, it } from "vitest";

import { safeAssignmentAuditSnapshot, safeStaffAuditSnapshot } from "./staff-audit-snapshot";

describe("safe staff audit snapshots", () => {
  it("giữ đủ trường hồ sơ nhưng che CCCD và số tài khoản", () => {
    const snapshot = safeStaffAuditSnapshot({
      staffCode: "LIVE01",
      fullName: "Nhân viên A",
      streamingAlias: "kenh-a",
      tiktokChannelId: "kenha",
      email: "a@example.com",
      phone: "0900000000",
      dateOfBirth: new Date("2000-01-02T00:00:00.000Z"),
      citizenIdNumber: "001234567890",
      bankAccountNumber: "1234567890",
      bankName: "Ngân hàng A",
      permanentAddress: "Địa chỉ A",
      temporaryAddress: null,
      facebookUrl: "https://facebook.com/a",
      university: "Đại học A",
      jobTitle: "Nhân viên Live",
      baseSalaryAmount: 7_000_000n,
      joinedDate: new Date("2026-07-01T00:00:00.000Z"),
      officialDate: null,
      terminationDate: null,
      employmentCategory: "PROBATION",
      employmentStatus: "ACTIVE",
      version: 1,
    });

    expect(snapshot).toMatchObject({
      staffCode: "LIVE01",
      tiktokChannelId: "kenha",
      citizenIdNumber: { redacted: true, present: true },
      bankAccountNumber: { redacted: true, present: true },
      baseSalaryAmount: "7000000",
    });
    expect(JSON.stringify(snapshot)).not.toContain("001234567890");
    expect(JSON.stringify(snapshot)).not.toContain("1234567890");
    expect(snapshot).not.toHaveProperty("objectKey");
  });

  it("ghi đầy đủ khoảng hiệu lực phân công", () => {
    expect(
      safeAssignmentAuditSnapshot({
        id: "assignment-a",
        branchId: "branch-a",
        staffId: "staff-a",
        assignmentType: "MEMBER",
        attendanceMachineCode: "00033",
        effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        effectiveTo: null,
        version: 2,
      }),
    ).toEqual({
      assignmentId: "assignment-a",
      branchId: "branch-a",
      staffId: "staff-a",
      assignmentType: "MEMBER",
      attendanceMachineCode: "00033",
      effectiveFrom: "2026-07-01",
      effectiveTo: null,
      version: 2,
    });
  });
});
