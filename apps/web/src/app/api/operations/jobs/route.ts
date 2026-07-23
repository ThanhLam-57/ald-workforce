import { prisma } from "@ald/db";
import { DomainError } from "@ald/domain";

import { requireActor } from "@/server/auth-context";
import { json, toErrorResponse } from "@/server/http";
import { getJobQueueOverview } from "@/server/job-queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    if (actor.role !== "GENERAL_MANAGER") {
      throw new DomainError("FORBIDDEN", "Chỉ Tổng quản lý được xem trạng thái job.");
    }

    const [queues, dataExports, payrollExports] = await Promise.all([
      getJobQueueOverview(),
      prisma.dataExportJob.groupBy({
        by: ["status"],
        where: { companyId: actor.companyId },
        _count: { _all: true },
      }),
      prisma.payrollExportJob.groupBy({
        by: ["status"],
        where: { companyId: actor.companyId },
        _count: { _all: true },
      }),
    ]);

    return json({
      data: {
        queues,
        records: {
          dataExports: dataExports.map((item) => ({
            status: item.status,
            count: item._count._all,
          })),
          payrollExports: payrollExports.map((item) => ({
            status: item.status,
            count: item._count._all,
          })),
        },
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
