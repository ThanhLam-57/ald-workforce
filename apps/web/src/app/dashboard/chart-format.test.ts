import { describe, expect, it } from "vitest";

import { compactChartNumber, truncateChartLabel } from "./chart-format";

describe("chart text formatting", () => {
  it("giữ nhãn ngắn và thu gọn nhãn dài trong trục biểu đồ", () => {
    expect(truncateChartLabel("Xuân Thủy", 12)).toBe("Xuân Thủy");
    expect(truncateChartLabel("Nhân viên có tên rất dài", 12)).toBe("Nhân viên c…");
    expect(truncateChartLabel("ABC", 1)).toBe("…");
  });

  it("định dạng số trục theo dạng gọn và không trả về NaN", () => {
    expect(compactChartNumber(1_500)).toBe("1,5 N");
    expect(compactChartNumber("not-a-number")).toBe("0");
  });
});
