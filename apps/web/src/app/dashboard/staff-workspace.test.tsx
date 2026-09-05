import type { BranchStaffDto } from "@ald/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StaffWorkspace } from "./staff-workspace";
import { staffWorkspaceCapabilitiesFor } from "./staff-workspace-capabilities";

const branch = { id: "branch-a", code: "XT_01", name: "Xuân Thủy" } as const;

function staffMember(
  input: Readonly<{
    id: string;
    staffCode: string;
    fullName: string;
    joinedDate: string | null;
    officialDate: string | null;
  }>,
): BranchStaffDto {
  return {
    id: input.id,
    branch,
    staffCode: input.staffCode,
    assignmentId: `assignment-${input.id}`,
    attendanceMachineCode: null,
    assignmentVersion: 1,
    assignmentEffectiveFrom: "2026-06-01",
    assignmentEffectiveTo: null,
    fullName: input.fullName,
    streamingAlias: null,
    tiktokChannelId: null,
    email: null,
    phone: null,
    dateOfBirth: null,
    citizenIdNumber: null,
    bankAccountNumber: null,
    bankName: null,
    permanentAddress: null,
    temporaryAddress: null,
    facebookUrl: null,
    university: null,
    jobTitle: "Nhân viên Live",
    joinedDate: input.joinedDate,
    officialDate: input.officialDate,
    terminationDate: null,
    employmentCategory: input.officialDate ? "OFFICIAL" : "PROBATION",
    employmentStatus: "ACTIVE",
    currentSchedule: null,
    identityDocuments: [],
    bankQrDocument: null,
    version: 1,
  };
}

describe("StaffWorkspace employee list", () => {
  it("hiển thị ngày thử việc và ngày chính thức theo từng nhân viên", () => {
    const html = renderToStaticMarkup(
      <StaffWorkspace
        capabilities={staffWorkspaceCapabilitiesFor("GENERAL_MANAGER")}
        initialBranches={[branch]}
        initialStaff={[
          staffMember({
            id: "staff-1",
            staffCode: "NV_XT_001",
            fullName: "Nguyễn Văn A",
            joinedDate: "2026-06-01",
            officialDate: "2026-07-15",
          }),
          staffMember({
            id: "staff-2",
            staffCode: "NV_XT_002",
            fullName: "Nguyễn Văn B",
            joinedDate: null,
            officialDate: null,
          }),
        ]}
      />,
    );

    expect(html).toContain("Ngày thử việc");
    expect(html).toContain("Ngày chính thức");
    expect(html).toContain("01/06/2026");
    expect(html).toContain("15/07/2026");
    expect(html.match(/<th(?:\s|>)/g)).toHaveLength(12);
    expect(html.match(/<td(?:\s|>)/g)).toHaveLength(24);
  });
});
