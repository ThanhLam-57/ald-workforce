import { describe, expect, it } from "vitest";

import {
  branchAbbreviationFromCode,
  formatGeneratedStaffCode,
  suggestStaffCode,
} from "./staff-code.js";

describe("mã nhân viên tự động", () => {
  it.each([
    ["XT_01", "XT"],
    ["HN_02", "HN"],
    ["SG-01", "SG"],
  ])("lấy viết tắt từ %s", (branchCode, expected) => {
    expect(branchAbbreviationFromCode(branchCode)).toBe(expected);
  });

  it("bắt đầu từ 001 khi chưa có mã", () => {
    expect(suggestStaffCode("XT_01", [])).toEqual({
      branchAbbreviation: "XT",
      nextSequence: 1,
      suggestedStaffCode: "NV_XT_001",
    });
  });

  it("đọc cả mã NV và mã VN cũ, đồng thời bỏ qua mã sai cấu trúc", () => {
    expect(
      suggestStaffCode("XT_01", [
        "NV_XT_001",
        "VN_XT_002",
        "NV_XT_005",
        "NV_XT_KHONGPHAISO",
        "NV_HN_999",
        "NV_XT_000",
      ]),
    ).toMatchObject({ nextSequence: 6, suggestedStaffCode: "NV_XT_006" });
  });

  it("không giới hạn hậu tố ở ba chữ số", () => {
    expect(suggestStaffCode("XT_01", ["NV_XT_999"]).suggestedStaffCode).toBe("NV_XT_1000");
  });

  it("từ chối mã cơ sở không thể tạo viết tắt", () => {
    expect(() => branchAbbreviationFromCode("_01")).toThrow(
      "Không thể tạo viết tắt hợp lệ từ mã cơ sở.",
    );
  });

  it("từ chối sequence không hợp lệ", () => {
    expect(() => formatGeneratedStaffCode("XT", 0)).toThrow("Số thứ tự mã nhân viên không hợp lệ.");
  });
});
