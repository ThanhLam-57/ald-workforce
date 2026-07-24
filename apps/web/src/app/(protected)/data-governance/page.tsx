import { DataGovernanceWorkspace } from "@/app/dashboard/data-governance-workspace";
import { listBranches } from "@/server/services";

import { PageHeader } from "../page-header";
import { requirePageActor } from "../page-access";

export default async function DataGovernancePage() {
  const actor = await requirePageActor(["GENERAL_MANAGER", "TRAINING_MANAGER"]);
  const branches = await listBranches(actor);

  return (
    <>
      <PageHeader
        description="Import dữ liệu cũ, theo dõi export job và tra cứu audit trong đúng phạm vi được cấp."
        eyebrow="Quản trị dữ liệu"
        title="Import, Export Center & Audit"
      />
      <DataGovernanceWorkspace
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
