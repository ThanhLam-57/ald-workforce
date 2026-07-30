import { StaffWorkspace } from "@/app/dashboard/staff-workspace";
import { staffWorkspaceCapabilitiesFor } from "@/app/dashboard/staff-workspace-capabilities";
import { listBranchStaff, listStaffOnboardingBranches } from "@/server/staff-onboarding-service";

import { requirePageActor } from "../page-access";
import { PageHeader } from "../page-header";

export default async function StaffPage() {
  const actor = await requirePageActor(["GENERAL_MANAGER", "TRAINING_MANAGER"]);
  const [branches, staff] = await Promise.all([
    listStaffOnboardingBranches(actor),
    listBranchStaff(actor),
  ]);

  return (
    <>
      <PageHeader
        description="Thêm nhân viên Live trong cơ sở được phân công, thiết lập ca và lưu hai mặt CCCD riêng tư."
        eyebrow="Quản lý nhân sự"
        title="Nhân viên"
      />
      <StaffWorkspace
        capabilities={staffWorkspaceCapabilitiesFor(actor.role)}
        initialBranches={branches}
        initialStaff={staff}
      />
    </>
  );
}
