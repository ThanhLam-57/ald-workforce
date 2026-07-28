import { describe, expect, it } from "vitest";

import {
  REPORTING_REFRESH_DEDUPLICATION_MS,
  shouldRefreshReportingData,
} from "./use-reporting-auto-refresh";

describe("reporting data freshness", () => {
  it("refreshes visible reporting data after the deduplication window", () => {
    expect(
      shouldRefreshReportingData({
        documentVisible: true,
        lastTriggeredAt: 1_000,
        now: 1_000 + REPORTING_REFRESH_DEDUPLICATION_MS,
      }),
    ).toBe(true);
  });

  it("does not query while the page is hidden", () => {
    expect(
      shouldRefreshReportingData({
        documentVisible: false,
        lastTriggeredAt: 0,
        now: 10_000,
      }),
    ).toBe(false);
  });

  it("deduplicates focus, visibility and pageshow events fired together", () => {
    expect(
      shouldRefreshReportingData({
        documentVisible: true,
        lastTriggeredAt: 10_000,
        now: 10_000 + REPORTING_REFRESH_DEDUPLICATION_MS - 1,
      }),
    ).toBe(false);
  });
});
