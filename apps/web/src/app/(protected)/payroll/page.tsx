import { PayrollWorkspace } from "@/app/dashboard/payroll-workspace";
import { listBranches } from "@/server/services";

import { PageHeader } from "../page-header";
import { requirePageActor } from "../page-access";

export default async function PayrollPage() {
  const actor = await requirePageActor(["GENERAL_MANAGER"]);
  const branches = await listBranches(actor);

  return (
    <>
      <PageHeader
        description="Tính toán, review, điều chỉnh, khóa, publish và xuất bảng lương theo kỳ."
        eyebrow="Vận hành tài chính"
        title="Payroll"
      />
      <PayrollWorkspace
        branches={branches.map((branch) => ({
          id: branch.id,
          code: branch.code,
          name: branch.name,
        }))}
        isGeneralManager
      />
    </>
  );
}
