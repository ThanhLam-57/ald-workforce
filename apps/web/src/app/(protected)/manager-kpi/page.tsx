import { ManagerKpiWorkspace } from "@/app/dashboard/manager-kpi-workspace";

import { PageHeader } from "../page-header";
import { requirePageActor } from "../page-access";

export default async function ManagerKpiPage() {
  const actor = await requirePageActor(["GENERAL_MANAGER", "TRAINING_MANAGER"]);

  return (
    <>
      <PageHeader
        description="Đánh giá KPI theo template hiệu lực; quản lý chỉ thấy kết quả của mình khi đã publish và policy cho phép."
        eyebrow="Hiệu suất quản lý"
        title="KPI quản lý đào tạo"
      />
      <ManagerKpiWorkspace isGeneralManager={actor.role === "GENERAL_MANAGER"} />
    </>
  );
}
