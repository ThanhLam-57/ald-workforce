import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { createCsvExport, createXlsxExport } from "./data-export";

const malicious = '=HYPERLINK("https://example.invalid")';
const data = {
  title: "Formula safety",
  fileBase: "formula-safety",
  headers: ["Tên", "Giá trị"],
  rows: [[malicious, 100]] as const,
};

describe("data export formula injection prevention", () => {
  it("escapes CSV fields that could become formulas", () => {
    const csv = createCsvExport(data).toString("utf8");
    expect(csv).toContain(`'${malicious.replace(/"/g, '""')}`);
    expect(csv).not.toContain(`\r\n${malicious}`);
  });

  it("writes formula-like XLSX data as literal text", async () => {
    const buffer = await createXlsxExport(data);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
    expect(workbook.getWorksheet("Dữ liệu")?.getCell("A4").value).toBe(`'${malicious}`);
    expect(workbook.getWorksheet("Dữ liệu")?.getCell("A4").type).toBe(ExcelJS.ValueType.String);
  });
});
