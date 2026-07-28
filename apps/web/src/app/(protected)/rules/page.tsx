import { SimpleRulesWorkspace } from "@/app/dashboard/simple-rules-workspace";
import { listBranches } from "@/server/services";

import { requirePageActor } from "../page-access";
import { PageHeader } from "../page-header";

export default async function RulesPage() {
  const actor = await requirePageActor(["GENERAL_MANAGER", "TRAINING_MANAGER"]);
  const isGeneralManager = actor.role === "GENERAL_MANAGER";
  const branches = await listBranches(actor);

  return (
    <>
      <PageHeader
        description={
          isGeneralManager
            ? "Thiết lập thưởng ngày, phạt theo số lần và quy định lương. Dữ liệu được tự động áp dụng cho Chấm công & Live và Payroll."
            : "Xem các mốc thưởng, mức phạt và điều kiện đang được áp dụng trong vận hành."
        }
        eyebrow="Quy định"
        title="Thưởng, phạt & lương"
      />
      <SimpleRulesWorkspace
        branches={branches.map((branch) => ({
          id: branch.id,
          code: branch.code,
          name: branch.name,
          isActive: branch.isActive,
        }))}
        canEdit={isGeneralManager}
      />
    </>
  );
}
