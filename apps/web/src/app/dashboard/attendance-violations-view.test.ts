import { describe, expect, it } from "vitest";

import {
  activeViolationBadges,
  type ViolationBadge,
} from "./attendance-violations-view";

function violation(
  id: string,
  itemName: string,
  status: ViolationBadge["status"] = "ACTIVE",
  origin: ViolationBadge["origin"] = "MANUAL",
): ViolationBadge {
  return {
    id,
    itemName,
    status,
    origin,
    displayColor: status === "ACTIVE" ? "#dc2626" : "#64748b",
  };
}

describe("attendance violation cell", () => {
  it("shows one active violation title", () => {
    expect(activeViolationBadges([violation("one", "Đi muộn")])).toEqual([
      expect.objectContaining({ itemName: "Đi muộn" }),
    ]);
  });

  it("shows every active violation title in source order", () => {
    expect(
      activeViolationBadges([
        violation("one", "Đi muộn"),
        violation("two", "Live thiếu giờ"),
        violation("three", "Trang phục"),
      ]).map((item) => item.itemName),
    ).toEqual(["Đi muộn", "Live thiếu giờ", "Trang phục"]);
  });

  it("shows both manual and automatic violations", () => {
    expect(
      activeViolationBadges([
        violation("manual", "Trang phục", "ACTIVE", "MANUAL"),
        violation("automatic", "Đi muộn", "ACTIVE", "AUTOMATIC"),
      ]).map((item) => item.origin),
    ).toEqual(["MANUAL", "AUTOMATIC"]);
  });

  it("hides cancelled violations from the table cell", () => {
    expect(
      activeViolationBadges([
        violation("active", "Đi muộn"),
        violation("cancelled", "Làm việc riêng", "CANCELLED"),
      ]).map((item) => item.itemName),
    ).toEqual(["Đi muộn"]);
  });
});
