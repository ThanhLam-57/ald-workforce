import { CompanyIntelligenceWorkspace } from "@/app/dashboard/company-intelligence-workspace";
import { ManagerCompanyReportWorkspace } from "@/app/dashboard/manager-company-report-workspace";
import { listBranches } from "@/server/services";

import { PageHeader } from "../page-header";
import { requirePageActor } from "../page-access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CompanyReportPage() {
  const actor = await requirePageActor(["GENERAL_MANAGER", "TRAINING_MANAGER"]);
  const branches = await listBranches(actor);
  const branchOptions = branches.map((branch) => ({
    id: branch.id,
    code: branch.code,
    name: branch.name,
  }));

  if (actor.role === "TRAINING_MANAGER") {
    return (
      <>
        <PageHeader
          description="Theo dõi xu, công, thời lượng Live, tăng ca và vi phạm trong các cơ sở đang được phân công."
          eyebrow="Phạm vi quản lý"
          title="Báo cáo vận hành"
        />
        <ManagerCompanyReportWorkspace branches={branchOptions} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        description="Theo dõi doanh số, payroll, phạt/thưởng và các điểm cần xử lý trên toàn công ty."
        eyebrow="Dành cho Tổng quản lý"
        title="Dashboard và báo cáo công ty"
      />
      <CompanyIntelligenceWorkspace branches={branchOptions} />
    </>
  );
}
