import ExcelJS from "exceljs";

const MAX_HEADER_SCAN_ROWS = 20;
const MAX_IMPORT_SHEETS = 20;
const MAX_IMPORT_COLUMNS = 100;
const MAX_IMPORT_ROWS = 50_000;

type RequiredColumn = "machineCode" | "businessDate" | "checkInTime" | "checkOutTime";

export type AttendanceMachineImportParseIssue = Readonly<{
  columnName: RequiredColumn;
  code: string;
  message: string;
}>;

export type ParsedAttendanceMachineRow = Readonly<{
  sheetName: string;
  rowNumber: number;
  machineCode: string;
  businessDate: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  issues: readonly AttendanceMachineImportParseIssue[];
}>;

export type ParsedAttendanceMachineWorkbook = Readonly<{
  sheetName: string;
  headerRowNumber: number;
  headers: readonly string[];
  rows: readonly ParsedAttendanceMachineRow[];
}>;

const expectedHeaders: Readonly<Record<string, RequiredColumn>> = {
  "ma nhan vien": "machineCode",
  ngay: "businessDate",
  "gio vao": "checkInTime",
  "gio ra": "checkOutTime",
};

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeMachineCode(value: string): string {
  return value.trim().toUpperCase();
}

function machineCodeText(cell: ExcelJS.Cell): string {
  if (typeof cell.value === "number" && Number.isSafeInteger(cell.value) && cell.value >= 0) {
    const primaryFormat = cell.numFmt.split(";")[0]?.trim() ?? "";
    if (/^0+$/.test(primaryFormat)) {
      return String(cell.value).padStart(primaryFormat.length, "0");
    }
  }
  return cell.text;
}

function isFormulaCell(cell: ExcelJS.Cell): boolean {
  const value = cell.value;
  return (
    typeof value === "object" && value !== null && ("formula" in value || "sharedFormula" in value)
  );
}

function isFormulaLikeText(value: string): boolean {
  const trimmed = value.trimStart();
  return /^[=+@]/.test(trimmed) || /^-[A-Za-z]/.test(trimmed);
}

function validCalendarDate(year: number, month: number, day: number): string | null {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function dateFromSerial(value: number, date1904: boolean): string | null {
  if (!Number.isFinite(value)) return null;
  const wholeDays = Math.floor(value);
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(base + wholeDays * 86_400_000);
  return validCalendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function parseBusinessDate(cell: ExcelJS.Cell, date1904: boolean): string | null {
  if (cell.value instanceof Date) {
    return validCalendarDate(
      cell.value.getUTCFullYear(),
      cell.value.getUTCMonth() + 1,
      cell.value.getUTCDate(),
    );
  }
  if (typeof cell.value === "number") {
    return dateFromSerial(cell.value, date1904);
  }

  const text = cell.text.trim();
  if (!text) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) {
    return validCalendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  const vietnamese = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (!vietnamese) return null;
  const rawYear = Number(vietnamese[3]);
  const year = vietnamese[3]?.length === 2 ? 2_000 + rawYear : rawYear;
  return validCalendarDate(year, Number(vietnamese[2]), Number(vietnamese[1]));
}

function formatMinutes(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1_440) + 1_440) % 1_440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseClockTime(cell: ExcelJS.Cell): string | null {
  if (cell.value instanceof Date) {
    return formatMinutes(cell.value.getUTCHours() * 60 + cell.value.getUTCMinutes());
  }
  if (typeof cell.value === "number" && Number.isFinite(cell.value) && cell.value >= 0) {
    return formatMinutes(Math.round((cell.value - Math.floor(cell.value)) * 1_440));
  }

  const text = cell.text.trim();
  if (!text) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return formatMinutes(hours * 60 + minutes);
}

type HeaderCandidate = Readonly<{
  worksheet: ExcelJS.Worksheet;
  rowNumber: number;
  columns: Readonly<Record<RequiredColumn, number>>;
  headers: readonly string[];
}>;

function findHeaderCandidates(workbook: ExcelJS.Workbook): readonly HeaderCandidate[] {
  const candidates: HeaderCandidate[] = [];
  for (const worksheet of workbook.worksheets) {
    if (worksheet.columnCount > MAX_IMPORT_COLUMNS) {
      throw new Error(`Sheet ${worksheet.name} vượt quá ${MAX_IMPORT_COLUMNS} cột.`);
    }
    const lastHeaderRow = Math.min(MAX_HEADER_SCAN_ROWS, worksheet.rowCount);
    for (let rowNumber = 1; rowNumber <= lastHeaderRow; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const columns = new Map<RequiredColumn, number>();
      const headers: string[] = [];
      let duplicateRequiredHeader = false;
      for (let columnNumber = 1; columnNumber <= worksheet.columnCount; columnNumber += 1) {
        const header = row.getCell(columnNumber).text.trim();
        headers.push(header);
        const key = expectedHeaders[normalizeHeader(header)];
        if (!key) continue;
        if (columns.has(key)) {
          duplicateRequiredHeader = true;
          break;
        }
        columns.set(key, columnNumber);
      }
      if (duplicateRequiredHeader) {
        throw new Error(`Sheet ${worksheet.name}, dòng ${rowNumber} có tiêu đề bắt buộc trùng.`);
      }
      if (columns.size === 4) {
        candidates.push({
          worksheet,
          rowNumber,
          columns: Object.fromEntries(columns) as Record<RequiredColumn, number>,
          headers,
        });
      }
    }
  }
  return candidates;
}

function formulaIssue(columnName: RequiredColumn): AttendanceMachineImportParseIssue {
  return {
    columnName,
    code: "FORMULA_NOT_ALLOWED",
    message: "Không cho phép công thức trong cột dữ liệu máy chấm công.",
  };
}

export async function parseAttendanceMachineWorkbook(
  bytes: Uint8Array,
): Promise<ParsedAttendanceMachineWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  if (workbook.worksheets.length === 0 || workbook.worksheets.length > MAX_IMPORT_SHEETS) {
    throw new Error(`File phải có từ 1 đến ${MAX_IMPORT_SHEETS} sheet.`);
  }

  const candidates = findHeaderCandidates(workbook);
  if (candidates.length === 0) {
    throw new Error("Không tìm thấy dòng tiêu đề có đủ Mã Nhân Viên, Ngày, Giờ vào và Giờ ra.");
  }
  if (candidates.length > 1) {
    throw new Error(
      "File có nhiều bảng máy chấm công; hãy giữ lại đúng một bảng trước khi import.",
    );
  }

  const candidate = candidates[0]!;
  if (candidate.worksheet.rowCount - candidate.rowNumber > MAX_IMPORT_ROWS) {
    throw new Error(`File vượt quá ${MAX_IMPORT_ROWS.toLocaleString("vi-VN")} dòng dữ liệu.`);
  }
  const rows: ParsedAttendanceMachineRow[] = [];
  for (
    let rowNumber = candidate.rowNumber + 1;
    rowNumber <= candidate.worksheet.rowCount;
    rowNumber += 1
  ) {
    const row = candidate.worksheet.getRow(rowNumber);
    const machineCodeCell = row.getCell(candidate.columns.machineCode);
    const businessDateCell = row.getCell(candidate.columns.businessDate);
    const checkInCell = row.getCell(candidate.columns.checkInTime);
    const checkOutCell = row.getCell(candidate.columns.checkOutTime);
    const cells = [machineCodeCell, businessDateCell, checkInCell, checkOutCell];
    if (
      cells.every((cell) => cell.value === null || cell.value === undefined || !cell.text.trim())
    ) {
      continue;
    }

    const issues: AttendanceMachineImportParseIssue[] = [];
    const requiredCells = {
      machineCode: machineCodeCell,
      businessDate: businessDateCell,
      checkInTime: checkInCell,
      checkOutTime: checkOutCell,
    } as const;
    for (const [columnName, cell] of Object.entries(requiredCells) as [
      RequiredColumn,
      ExcelJS.Cell,
    ][]) {
      if (isFormulaCell(cell) || isFormulaLikeText(cell.text)) {
        issues.push(formulaIssue(columnName));
      }
    }

    const machineCode = normalizeMachineCode(machineCodeText(machineCodeCell));
    if (!machineCode) {
      issues.push({
        columnName: "machineCode",
        code: "MACHINE_CODE_REQUIRED",
        message: "Thiếu Mã Nhân Viên.",
      });
    } else if (!/^[A-Z0-9_-]{1,30}$/.test(machineCode)) {
      issues.push({
        columnName: "machineCode",
        code: "INVALID_MACHINE_CODE",
        message: "Mã Nhân Viên không đúng định dạng mã máy chấm công.",
      });
    }

    const businessDate = parseBusinessDate(businessDateCell, workbook.properties.date1904);
    if (!businessDate) {
      issues.push({
        columnName: "businessDate",
        code: "INVALID_BUSINESS_DATE",
        message: "Ngày không hợp lệ.",
      });
    }

    const checkInTime = parseClockTime(checkInCell);
    if (checkInCell.text.trim() && !checkInTime) {
      issues.push({
        columnName: "checkInTime",
        code: "INVALID_CHECK_IN_TIME",
        message: "Giờ vào phải có định dạng HH:mm.",
      });
    }
    const checkOutTime = parseClockTime(checkOutCell);
    if (checkOutCell.text.trim() && !checkOutTime) {
      issues.push({
        columnName: "checkOutTime",
        code: "INVALID_CHECK_OUT_TIME",
        message: "Giờ ra phải có định dạng HH:mm.",
      });
    }

    rows.push({
      sheetName: candidate.worksheet.name,
      rowNumber,
      machineCode,
      businessDate,
      checkInTime,
      checkOutTime,
      issues,
    });
  }

  return {
    sheetName: candidate.worksheet.name,
    headerRowNumber: candidate.rowNumber,
    headers: candidate.headers.filter(Boolean),
    rows,
  };
}
