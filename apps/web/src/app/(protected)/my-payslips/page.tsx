import { PayrollWorkspace } from "@/app/dashboard/payroll-workspace";

import { PageHeader } from "../page-header";
import { requirePageActor } from "../page-access";

export default async function MyPayslipsPage() {
  await requirePageActor(["LIVE_EMPLOYEE"]);

  return (
    <>
      <PageHeader
        description="Xem breakdown và tải phiếu lương của chính bạn sau khi kỳ lương được publish."
        eyebrow="Thu nhập cá nhân"
        title="Phiếu lương của tôi"
      />
      <PayrollWorkspace branches={[]} canManagePayroll={false} />
    </>
  );
}
