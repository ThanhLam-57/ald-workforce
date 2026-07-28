import { toBusinessDateString } from "@ald/domain";

import { AttendanceWorkspace } from "@/app/dashboard/attendance-workspace";
import { getAttendanceFilterOptions } from "@/server/attendance-service";

import { PageHeader } from "../page-header";
import { requirePageActor } from "../page-access";

export default async function AttendancePage() {
  const actor = await requirePageActor(["GENERAL_MANAGER", "TRAINING_MANAGER"]);
  const month = toBusinessDateString(new Date()).slice(0, 7);
  const initialOptions = await getAttendanceFilterOptions(actor, month);

  return (
    <div className="flex min-w-0 max-w-full flex-col xl:h-[calc(100dvh-8rem)] xl:overflow-hidden">
      <PageHeader
        description="Nhập và đối soát check-in, check-out, công, Live, doanh số, tăng ca và lỗi theo từng ngày."
        eyebrow="Vận hành tháng"
        title="Chấm công & Live"
      />
      <AttendanceWorkspace
        canOverridePenalty={actor.role === "GENERAL_MANAGER"}
        initialOptions={initialOptions}
      />
    </div>
  );
}
