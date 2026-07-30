import { describe, expect, it } from "vitest";

import { evaluateAutomaticPenalty } from "./automatic-penalties.js";

const present = {
  status: "PRESENT" as const,
  businessDate: "2026-07-27",
  actualLiveMinutes: 0,
};

describe("automatic attendance penalties", () => {
  const lateCondition = {
    type: "CHECK_IN_LATE" as const,
    scheduledStartMinutes: 9 * 60,
    graceMinutes: 15,
    branchId: null,
  };

  it.each([
    ["2026-07-27T02:00:00.000Z", "PASS"],
    ["2026-07-27T02:15:00.000Z", "PASS"],
    ["2026-07-27T02:16:00.000Z", "VIOLATION"],
  ] as const)("đánh giá check-in %s tại biên phút du di", (checkInAt, status) => {
    expect(
      evaluateAutomaticPenalty(lateCondition, {
        ...present,
        checkInAt,
      }).status,
    ).toBe(status);
  });

  it("không kết luận đi muộn khi chưa có check-in", () => {
    expect(
      evaluateAutomaticPenalty(lateCondition, {
        ...present,
        checkInAt: null,
      }).status,
    ).toBe("INSUFFICIENT_DATA");
  });

  it("không tự phạt khi rule dùng ca nhân viên nhưng chưa resolve được ca", () => {
    expect(
      evaluateAutomaticPenalty(
        {
          type: "CHECK_IN_LATE",
          thresholdSource: "STAFF_SHIFT",
          graceMinutes: 15,
          branchId: null,
        },
        {
          ...present,
          checkInAt: "2026-07-27T03:00:00.000Z",
        },
      ),
    ).toMatchObject({
      status: "INSUFFICIENT_DATA",
      configuredMinutes: 0,
    });
  });

  it("so sánh cả ngày nghiệp vụ thay vì chỉ phần giờ trong ngày", () => {
    expect(
      evaluateAutomaticPenalty(lateCondition, {
        ...present,
        checkInAt: "2026-07-28T02:00:00.000Z",
      }).status,
    ).toBe("VIOLATION");
  });

  it.each([
    [360, "PASS"],
    [345, "PASS"],
    [344, "VIOLATION"],
    [0, "VIOLATION"],
  ] as const)("đánh giá %i phút Live tại biên du di", (actualLiveMinutes, status) => {
    expect(
      evaluateAutomaticPenalty(
        {
          type: "LIVE_DURATION_SHORT",
          requiredLiveMinutes: 360,
          graceMinutes: 15,
          branchId: null,
        },
        {
          ...present,
          checkInAt: null,
          actualLiveMinutes,
        },
      ).status,
    ).toBe(status);
  });

  it.each(["DRAFT", "ABSENT", "LEAVE"] as const)(
    "không tạo lỗi tự động cho trạng thái %s",
    (status) => {
      expect(
        evaluateAutomaticPenalty(lateCondition, {
          status,
          businessDate: "2026-07-27",
          checkInAt: "2026-07-27T03:00:00.000Z",
          actualLiveMinutes: 0,
        }).status,
      ).toBe("PASS");
    },
  );
});
