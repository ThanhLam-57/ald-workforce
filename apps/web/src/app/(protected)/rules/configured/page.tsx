import { ConfiguredRuleCenter } from "@/app/dashboard/configured-rule-center";

import { PageHeader } from "../../page-header";
import { requirePageActor } from "../../page-access";

export default async function ConfiguredRulesPage() {
  const actor = await requirePageActor(["GENERAL_MANAGER", "TRAINING_MANAGER"]);

  return (
    <>
      <PageHeader
        description="Quản lý rule thưởng ngày, level tháng, lương và KPI theo version và khoảng hiệu lực."
        eyebrow="Rule Center"
        title="Thưởng, level, lương & KPI"
      />
      <ConfiguredRuleCenter isGeneralManager={actor.role === "GENERAL_MANAGER"} />
    </>
  );
}
