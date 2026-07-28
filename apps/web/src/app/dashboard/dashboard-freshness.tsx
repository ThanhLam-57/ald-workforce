"use client";

import { Button } from "@ald/ui";
import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";

import { useReportingAutoRefresh } from "./use-reporting-auto-refresh";

export function DashboardFreshness() {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  useReportingAutoRefresh(refresh);

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-900">
      <span>Dữ liệu được làm mới khi quay lại trang và tự đồng bộ mỗi 30 giây.</span>
      <Button
        disabled={refreshing}
        onClick={refresh}
        type="button"
        variant="outline-sky"
      >
        {refreshing ? "Đang cập nhật…" : "Cập nhật ngay"}
      </Button>
    </div>
  );
}
