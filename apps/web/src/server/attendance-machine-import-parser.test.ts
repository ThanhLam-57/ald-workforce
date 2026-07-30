import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { parseAttendanceMachineWorkbook } from "./attendance-machine-import-parser";

type AttendanceRowValues = Readonly<{
  machineCode: ExcelJS.CellValue;
  businessDate: ExcelJS.CellValue;
  checkInTime?: ExcelJS.CellValue;
  checkOutTime?: ExcelJS.CellValue;
}>;

function addAttendanceHeaders(worksheet: ExcelJS.Worksheet, rowNumber = 3): void {
  worksheet.getCell(rowNumber, 2).value = "Mã Nhân Viên";
  worksheet.getCell(rowNumber, 5).value = "Ngày";
  worksheet.getCell(rowNumber, 7).value = "Giờ vào";
  worksheet.getCell(rowNumber, 8).value = "Giờ ra";
}

function addAttendanceRow(
  worksheet: ExcelJS.Worksheet,
  rowNumber: number,
  values: AttendanceRowValues,
): void {
  worksheet.getCell(rowNumber, 2).value = values.machineCode;
  worksheet.getCell(rowNumber, 5).value = values.businessDate;
  worksheet.getCell(rowNumber, 7).value = values.checkInTime ?? null;
  worksheet.getCell(rowNumber, 8).value = values.checkOutTime ?? null;
}

function createAttendanceWorkbook(): {
  workbook: ExcelJS.Workbook;
  worksheet: ExcelJS.Worksheet;
} {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Máy chấm công");
  worksheet.getCell("A1").value = "Báo cáo dữ liệu máy chấm công";
  addAttendanceHeaders(worksheet);
  return { workbook, worksheet };
}

async function workbookBytes(workbook: ExcelJS.Workbook): Promise<Uint8Array> {
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

function excelSerial(year: number, month: number, day: number, date1904 = false): number {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return (Date.UTC(year, month - 1, day) - base) / 86_400_000;
}

describe("parseAttendanceMachineWorkbook", () => {
  it("finds headers on row 3 at B/E/G/H and preserves padded machine codes", async () => {
    const { workbook, worksheet } = createAttendanceWorkbook();
    addAttendanceRow(worksheet, 4, {
      machineCode: "00033",
      businessDate: "30/07/2026",
      checkInTime: "08:00",
      checkOutTime: "17:00",
    });
    addAttendanceRow(worksheet, 5, {
      machineCode: 33,
      businessDate: "30/07/2026",
      checkInTime: "08:00",
      checkOutTime: "17:00",
    });
    worksheet.getCell(5, 2).numFmt = "00000";

    const result = await parseAttendanceMachineWorkbook(await workbookBytes(workbook));

    expect(result).toMatchObject({
      sheetName: "Máy chấm công",
      headerRowNumber: 3,
      headers: ["Mã Nhân Viên", "Ngày", "Giờ vào", "Giờ ra"],
    });
    expect(result.rows.map((row) => row.machineCode)).toEqual(["00033", "00033"]);
    expect(result.rows.map((row) => row.rowNumber)).toEqual([4, 5]);
    expect(result.rows.every((row) => row.issues.length === 0)).toBe(true);
  });

  it("parses Excel Date, serial, ISO text and Vietnamese text dates without shifting", async () => {
    const { workbook, worksheet } = createAttendanceWorkbook();
    addAttendanceRow(worksheet, 4, {
      machineCode: "DATE_VALUE",
      businessDate: new Date(Date.UTC(2026, 0, 15)),
    });
    worksheet.getCell(4, 5).numFmt = "dd/mm/yyyy";
    addAttendanceRow(worksheet, 5, {
      machineCode: "SERIAL_VALUE",
      businessDate: excelSerial(2026, 3, 29) + 0.75,
    });
    addAttendanceRow(worksheet, 6, {
      machineCode: "ISO_TEXT",
      businessDate: "2026-07-30",
    });
    addAttendanceRow(worksheet, 7, {
      machineCode: "VN_TEXT",
      businessDate: "31/12/26",
    });

    const result = await parseAttendanceMachineWorkbook(await workbookBytes(workbook));

    expect(result.rows.map((row) => row.businessDate)).toEqual([
      "2026-01-15",
      "2026-03-29",
      "2026-07-30",
      "2026-12-31",
    ]);
    expect(result.rows.every((row) => row.issues.length === 0)).toBe(true);
  });

  it("uses the workbook 1904 date system for numeric serial dates", async () => {
    const { workbook, worksheet } = createAttendanceWorkbook();
    workbook.properties.date1904 = true;
    addAttendanceRow(worksheet, 4, {
      machineCode: "SERIAL_1904",
      businessDate: excelSerial(2026, 7, 30, true),
    });

    const result = await parseAttendanceMachineWorkbook(await workbookBytes(workbook));

    expect(result.rows[0]?.businessDate).toBe("2026-07-30");
    expect(result.rows[0]?.issues).toEqual([]);
  });

  it("parses text, numeric and Date clock values, including midnight", async () => {
    const { workbook, worksheet } = createAttendanceWorkbook();
    addAttendanceRow(worksheet, 4, {
      machineCode: "TEXT_TIME",
      businessDate: "30/07/2026",
      checkInTime: "8:05",
      checkOutTime: "00:00",
    });
    addAttendanceRow(worksheet, 5, {
      machineCode: "NUMBER_TIME",
      businessDate: "30/07/2026",
      checkInTime: 8.5 / 24,
      checkOutTime: 0,
    });
    addAttendanceRow(worksheet, 6, {
      machineCode: "DATE_TIME",
      businessDate: "30/07/2026",
      checkInTime: new Date(Date.UTC(2026, 6, 30, 14, 45)),
      checkOutTime: new Date(Date.UTC(2026, 6, 30, 0, 0)),
    });
    worksheet.getCell(6, 7).numFmt = "hh:mm";
    worksheet.getCell(6, 8).numFmt = "hh:mm";

    const result = await parseAttendanceMachineWorkbook(await workbookBytes(workbook));

    expect(
      result.rows.map(({ checkInTime, checkOutTime }) => ({
        checkInTime,
        checkOutTime,
      })),
    ).toEqual([
      { checkInTime: "08:05", checkOutTime: "00:00" },
      { checkInTime: "08:30", checkOutTime: "00:00" },
      { checkInTime: "14:45", checkOutTime: "00:00" },
    ]);
    expect(result.rows.every((row) => row.issues.length === 0)).toBe(true);
  });

  it("keeps raw rows when one or both clock values are missing", async () => {
    const { workbook, worksheet } = createAttendanceWorkbook();
    addAttendanceRow(worksheet, 4, {
      machineCode: "NO_CHECK_IN",
      businessDate: "30/07/2026",
      checkOutTime: "17:00",
    });
    addAttendanceRow(worksheet, 5, {
      machineCode: "NO_CHECK_OUT",
      businessDate: "30/07/2026",
      checkInTime: "08:00",
    });
    addAttendanceRow(worksheet, 6, {
      machineCode: "NO_TIMES",
      businessDate: "30/07/2026",
    });

    const result = await parseAttendanceMachineWorkbook(await workbookBytes(workbook));

    expect(
      result.rows.map(({ machineCode, checkInTime, checkOutTime }) => ({
        machineCode,
        checkInTime,
        checkOutTime,
      })),
    ).toEqual([
      { machineCode: "NO_CHECK_IN", checkInTime: null, checkOutTime: "17:00" },
      { machineCode: "NO_CHECK_OUT", checkInTime: "08:00", checkOutTime: null },
      { machineCode: "NO_TIMES", checkInTime: null, checkOutTime: null },
    ]);
    expect(result.rows.every((row) => row.issues.length === 0)).toBe(true);
  });

  it("rejects clock values outside the supported 00:00 to 23:59 range", async () => {
    const { workbook, worksheet } = createAttendanceWorkbook();
    addAttendanceRow(worksheet, 4, {
      machineCode: "INVALID_TIME",
      businessDate: "30/07/2026",
      checkInTime: "24:00",
      checkOutTime: -0.25,
    });

    const result = await parseAttendanceMachineWorkbook(await workbookBytes(workbook));

    expect(result.rows[0]?.issues.map((issue) => issue.code)).toEqual([
      "INVALID_CHECK_IN_TIME",
      "INVALID_CHECK_OUT_TIME",
    ]);
  });

  it("reports formulas in every required input column", async () => {
    const { workbook, worksheet } = createAttendanceWorkbook();
    worksheet.getCell(4, 2).value = {
      formula: 'CONCAT("000","33")',
      result: "00033",
    };
    worksheet.getCell(4, 5).value = {
      formula: "DATE(2026,7,30)",
      result: excelSerial(2026, 7, 30),
    };
    worksheet.getCell(4, 5).numFmt = "dd/mm/yyyy";
    worksheet.getCell(4, 7).value = {
      formula: "TIME(8,0,0)",
      result: 8 / 24,
    };
    worksheet.getCell(4, 7).numFmt = "hh:mm";
    worksheet.getCell(4, 8).value = {
      formula: "TIME(17,0,0)",
      result: 17 / 24,
    };
    worksheet.getCell(4, 8).numFmt = "hh:mm";

    const result = await parseAttendanceMachineWorkbook(await workbookBytes(workbook));
    const formulaIssues = result.rows[0]?.issues.filter(
      (issue) => issue.code === "FORMULA_NOT_ALLOWED",
    );

    expect(formulaIssues?.map((issue) => issue.columnName)).toEqual([
      "machineCode",
      "businessDate",
      "checkInTime",
      "checkOutTime",
    ]);
  });

  it("reports formula-like text in required input columns", async () => {
    const { workbook, worksheet } = createAttendanceWorkbook();
    addAttendanceRow(worksheet, 4, {
      machineCode: "=A1",
      businessDate: "+TODAY",
      checkInTime: "@NOW",
      checkOutTime: "-NOW",
    });

    const result = await parseAttendanceMachineWorkbook(await workbookBytes(workbook));
    const formulaIssues = result.rows[0]?.issues.filter(
      (issue) => issue.code === "FORMULA_NOT_ALLOWED",
    );

    expect(formulaIssues?.map((issue) => issue.columnName)).toEqual([
      "machineCode",
      "businessDate",
      "checkInTime",
      "checkOutTime",
    ]);
  });

  it("rejects corrupt XLSX bytes", async () => {
    const corruptBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]);

    await expect(parseAttendanceMachineWorkbook(corruptBytes)).rejects.toThrow();
  });

  it("rejects a workbook with missing required headers", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Thiếu cột");
    worksheet.getCell("B3").value = "Mã Nhân Viên";
    worksheet.getCell("E3").value = "Ngày";
    worksheet.getCell("G3").value = "Giờ vào";

    await expect(parseAttendanceMachineWorkbook(await workbookBytes(workbook))).rejects.toThrow();
  });

  it("rejects duplicate required headers", async () => {
    const { workbook, worksheet } = createAttendanceWorkbook();
    worksheet.getCell("I3").value = "Mã nhân viên";

    await expect(parseAttendanceMachineWorkbook(await workbookBytes(workbook))).rejects.toThrow();
  });

  it("rejects workbooks containing more than one attendance table", async () => {
    const workbook = new ExcelJS.Workbook();
    const firstSheet = workbook.addWorksheet("Cơ sở 1");
    const secondSheet = workbook.addWorksheet("Cơ sở 2");
    addAttendanceHeaders(firstSheet);
    addAttendanceHeaders(secondSheet);

    await expect(parseAttendanceMachineWorkbook(await workbookBytes(workbook))).rejects.toThrow();
  });
});
