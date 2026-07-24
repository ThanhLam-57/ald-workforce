import { CompanyIntelligenceWorkspace } from "@/app/dashboard/company-intelligence-workspace";
import { listBranches } from "@/server/services";

import { PageHeader } from "../page-header";
import { requirePageActor } from "../page-access";

export default async function CompanyReportPage() {
  const actor = await requirePageActor(["GENERAL_MANAGER"]);
  const branches = await listBranches(actor);

  return (
    <>
      <PageHeader
        description="Theo dõi doanh số, payroll, phạt/thưởng và các điểm cần xử lý trên toàn công ty."
        eyebrow="Dành cho Tổng quản lý"
        title="Dashboard và báo cáo công ty"
      />
      <CompanyIntelligenceWorkspace
        branches={branches.map((branch) => ({
          id: branch.id,
          code: branch.code,
          name: branch.name,
        }))}
      />
    </>
  );
}
