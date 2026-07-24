import { AttendanceWorkspace } from "@/app/dashboard/attendance-workspace";
import { listAttendanceStaff } from "@/server/attendance-service";

import { PageHeader } from "../page-header";
import { requirePageActor } from "../page-access";

export default async function AttendancePage() {
  const actor = await requirePageActor(["GENERAL_MANAGER", "TRAINING_MANAGER"]);
  const staff = await listAttendanceStaff(actor, new Date());

  return (
    <>
      <PageHeader
        description="Nhập và đối soát check-in, check-out, công, Live, doanh số, tăng ca và lỗi theo từng ngày."
        eyebrow="Vận hành tháng"
        title="Chấm công & Live"
      />
      <AttendanceWorkspace canOverridePenalty={actor.role === "GENERAL_MANAGER"} staff={staff} />
    </>
  );
}
