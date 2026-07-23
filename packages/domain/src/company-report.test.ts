import { describe, expect, it } from "vitest";

import {
  businessWeekOfMonth,
  calculateKpiEvaluationScore,
  enumerateBusinessWeeks,
} from "./index.js";

describe("calendar/business weeks", () => {
  it("starts on Monday, clips partial weeks and supports week 5", () => {
    const weeks = enumerateBusinessWeeks("2026-09");

    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toMatchObject({
      weekNo: 1,
      from: "2026-09-01",
      to: "2026-09-06",
    });
    expect(weeks[4]).toMatchObject({
      weekNo: 5,
      from: "2026-09-28",
      to: "2026-09-30",
    });
    expect(businessWeekOfMonth("2026-09-07")).toBe(2);
    expect(businessWeekOfMonth("2026-09-30")).toBe(5);
  });

  it("supports a sixth partial calendar week when the month requires it", () => {
    const weeks = enumerateBusinessWeeks("2026-08");

    expect(weeks).toHaveLength(6);
    expect(weeks[5]?.dates).toEqual(["2026-08-31"]);
  });
});

describe("manager KPI score", () => {
  it("weights decimal scores deterministically and validates maximums", () => {
    expect(
      calculateKpiEvaluationScore([
        { code: "QUALITY", weightBps: 6_000, maxScore: 100, score: "80.5" },
        { code: "TRAINING", weightBps: 4_000, maxScore: 50, score: "40" },
      ]),
    ).toEqual({
      totalScore: "64.3",
      maximumScore: "80",
      lines: [
        { code: "QUALITY", score: "80.5", weightedScore: "48.3" },
        { code: "TRAINING", score: "40", weightedScore: "16" },
      ],
    });
  });
});
