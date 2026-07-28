"use client";

import { useEffect, useRef } from "react";

export const REPORTING_REFRESH_INTERVAL_MS = 30_000;
export const REPORTING_REFRESH_DEDUPLICATION_MS = 500;

export function shouldRefreshReportingData(input: Readonly<{
  documentVisible: boolean;
  lastTriggeredAt: number;
  now: number;
}>): boolean {
  return (
    input.documentVisible &&
    input.now - input.lastTriggeredAt >= REPORTING_REFRESH_DEDUPLICATION_MS
  );
}

export function useReportingAutoRefresh(
  refresh: () => void | Promise<void>,
  options: Readonly<{
    enabled?: boolean;
    intervalMs?: number;
  }> = {},
) {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (options.enabled === false) return;

    let lastTriggeredAt = Date.now();
    let inFlight = false;
    let queued = false;

    const run = async () => {
      const now = Date.now();
      if (
        !shouldRefreshReportingData({
          documentVisible: document.visibilityState === "visible",
          lastTriggeredAt,
          now,
        })
      ) {
        return;
      }
      lastTriggeredAt = now;
      if (inFlight) {
        queued = true;
        return;
      }

      inFlight = true;
      try {
        await refreshRef.current();
      } finally {
        inFlight = false;
        if (queued) {
          queued = false;
          lastTriggeredAt = 0;
          void run();
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void run();
    };
    const onPageShow = () => void run();
    const onFocus = () => void run();
    const interval = window.setInterval(
      () => void run(),
      options.intervalMs ?? REPORTING_REFRESH_INTERVAL_MS,
    );

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [options.enabled, options.intervalMs]);
}
