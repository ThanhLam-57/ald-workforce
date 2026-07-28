import { PayrollWorkspace } from "@/app/dashboard/payroll-workspace";

import { listPayrollBranches } from "@/server/payroll-service";

import { PageHeader } from "../page-header";
import { requirePageActor } from "../page-access";

export default async function PayrollPage() {
  const actor = await requirePageActor(["GENERAL_MANAGER"]);
  const branches = await listPayrollBranches(actor);

  return (
    <>
      <PageHeader
        description="Chọn kỳ lương, cơ sở và nhân viên để chấm lương, điều chỉnh và gửi phiếu."
        eyebrow="Vận hành tài chính"
        title="Payroll"
      />
      <PayrollWorkspace
        branches={branches.map((branch) => ({
          id: branch.id,
          code: branch.code,
          name: branch.name,
        }))}
        canManagePayroll
      />
    </>
  );
}
