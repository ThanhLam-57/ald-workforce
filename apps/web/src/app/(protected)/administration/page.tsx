import { AdministrationWorkspace } from "@/app/dashboard/administration-workspace";
import { listBranches, listStaff } from "@/server/services";

import { PageHeader } from "../page-header";
import { requirePageActor } from "../page-access";

export default async function AdministrationPage() {
  const actor = await requirePageActor(["GENERAL_MANAGER"]);
  const [branches, staff] = await Promise.all([listBranches(actor), listStaff(actor, new Date())]);

  return (
    <>
      <PageHeader
        description="Quản lý cơ sở, hồ sơ nhân sự, phân công và tài khoản truy cập hệ thống."
        eyebrow="Thiết lập hệ thống"
        title="Quản trị nền tảng"
      />
      <AdministrationWorkspace
        activeBranchOptions={branches
          .filter((branch) => branch.isActive)
          .map((branch) => ({
            id: branch.id,
            label: `${branch.code} — ${branch.name}`,
          }))}
        assignableStaffOptions={staff
          .filter((person) => person.employmentStatus !== "TERMINATED")
          .map((person) => ({
            id: person.id,
            label: `${person.staffCode} — ${person.fullName}`,
          }))}
        branchOptions={branches.map((branch) => ({
          id: branch.id,
          label: `${branch.code} — ${branch.name}`,
        }))}
        staffOptions={staff.map((person) => ({
          id: person.id,
          label: `${person.staffCode} — ${person.fullName}`,
        }))}
      />
    </>
  );
}
