import { PenaltyRuleCenter } from "@/app/dashboard/penalty-rule-center";

import { PageHeader } from "../../page-header";
import { requirePageActor } from "../../page-access";

export default async function PenaltyRulesPage() {
  await requirePageActor(["GENERAL_MANAGER"]);

  return (
    <>
      <PageHeader
        description="Quản lý danh mục lỗi, mức phạt, lịch sử version và thời điểm hiệu lực."
        eyebrow="Rule Center"
        title="Rule phạt"
      />
      <PenaltyRuleCenter />
    </>
  );
}
