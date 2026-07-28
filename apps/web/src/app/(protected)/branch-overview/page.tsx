import { BranchOverviewWorkspace } from "@/app/dashboard/branch-overview-workspace";
import { listBranches } from "@/server/services";

import { PageHeader } from "../page-header";
import { requirePageActor } from "../page-access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BranchOverviewPage() {
  const actor = await requirePageActor(["GENERAL_MANAGER", "TRAINING_MANAGER"]);
  const branches = await listBranches(actor);

  return (
    <>
      <PageHeader
        description="Bảng tháng theo nhân viên với doanh số, thời lượng Live, công, tăng ca và tiền phạt."
        eyebrow="Phân tích cơ sở"
        title="Bảng tổng quan cơ sở"
      />
      <BranchOverviewWorkspace
        branches={branches.map((branch) => ({
          id: branch.id,
          code: branch.code,
          name: branch.name,
        }))}
        isGeneralManager={actor.role === "GENERAL_MANAGER"}
      />
    </>
  );
}
