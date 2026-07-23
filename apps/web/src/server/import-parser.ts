import type { ImportErrorDto, ImportTemplate, ImportTemplateDefinitionDto } from "@ald/contracts";
import ExcelJS from "exceljs";
import { Readable } from "node:stream";

const MAX_IMPORT_ROWS = 50_000;
const MAX_IMPORT_COLUMNS = 100;
const MAX_IMPORT_SHEETS = 20;
const FORMULA_LIKE_TEXT = /^[\s]*(?:[=+@]|-(?!\d+(?:[.,]\d+)?\s*$))/;

type FieldType =
  | "text"
  | "code"
  | "boolean"
  | "date"
  | "datetime"
  | "integer"
  | "amount"
  | "decimal"
  | "color"
  | "employmentCategory"
  | "employmentStatus"
  | "assignmentType"
  | "attendanceStatus"
  | "ruleStatus";

type FieldDefinition = ImportTemplateDefinitionDto["fields"][number] & {
  type: FieldType;
};

type TemplateDefinition = Omit<ImportTemplateDefinitionDto, "fields"> & {
  fields: readonly FieldDefinition[];
};

const field = (key: string, label: string, type: FieldType, required = true): FieldDefinition => ({
  key,
  label,
  type,
  required,
});

export const IMPORT_TEMPLATE_DEFINITIONS: readonly TemplateDefinition[] = [
  {
    template: "BRANCHES",
    label: "Cơ sở",
    fields: [
      field("code", "Mã cơ sở", "code"),
      field("name", "Tên cơ sở", "text"),
      field("address", "Địa chỉ", "text", false),
      field("isActive", "Đang hoạt động", "boolean", false),
    ],
  },
  {
    template: "STAFF",
    label: "Nhân viên",
    fields: [
      field("branchCode", "Mã cơ sở", "code"),
      field("staffCode", "Mã nhân viên", "code"),
      field("fullName", "Họ tên", "text"),
      field("streamingAlias", "ACC/Alias", "text", false),
      field("email", "Email", "text", false),
      field("phone", "Điện thoại", "text", false),
      field("jobTitle", "Chức danh", "text"),
      field("employmentCategory", "Loại nhân sự", "employmentCategory"),
      field("employmentStatus", "Trạng thái", "employmentStatus", false),
      field("effectiveFrom", "Hiệu lực từ", "date"),
    ],
  },
  {
    template: "ASSIGNMENTS",
    label: "Phân công cơ sở",
    fields: [
      field("branchCode", "Mã cơ sở", "code"),
      field("staffCode", "Mã nhân viên", "code"),
      field("assignmentType", "Loại phân công", "assignmentType"),
      field("effectiveFrom", "Hiệu lực từ", "date"),
      field("effectiveTo", "Hiệu lực đến", "date", false),
    ],
  },
  {
    template: "LEVELS",
    label: "Cấp độ hiệu suất",
    fields: [
      field("levelCode", "Mã cấp độ", "code"),
      field("levelName", "Tên cấp độ", "text"),
      field("displayOrder", "Thứ tự", "integer", false),
      field("isActive", "Đang hoạt động", "boolean", false),
      field("staffCode", "Mã nhân viên", "code", false),
      field("effectiveFrom", "Hiệu lực từ", "date", false),
      field("effectiveTo", "Hiệu lực đến", "date", false),
    ],
  },
  {
    template: "ATTENDANCE_LIVE",
    label: "Chấm công và Live",
    fields: [
      field("branchCode", "Mã cơ sở", "code"),
      field("staffCode", "Mã nhân viên", "code"),
      field("businessDate", "Ngày nghiệp vụ", "date"),
      field("checkInAt", "Check-in", "datetime", false),
      field("checkOutAt", "Check-out", "datetime", false),
      field("spansNextDay", "Qua ngày", "boolean", false),
      field("workUnits", "Số công", "decimal"),
      field("overtimeMinutes", "Phút tăng ca", "integer", false),
      field("status", "Trạng thái chấm công", "attendanceStatus"),
      field("actualLiveMinutes", "Phút Live", "integer", false),
      field("revenueAmount", "Doanh số", "amount", false),
      field("note", "Ghi chú", "text", false),
    ],
  },
  {
    template: "REWARD_RULES",
    label: "Rule thưởng ngày",
    fields: [
      field("ruleSetName", "Tên bộ rule", "text"),
      field("versionNo", "Phiên bản", "integer"),
      field("status", "Trạng thái", "ruleStatus"),
      field("effectiveFrom", "Hiệu lực từ", "date", false),
      field("effectiveTo", "Hiệu lực đến", "date", false),
      field("minRevenue", "Doanh số tối thiểu", "amount"),
      field("maxRevenue", "Doanh số tối đa", "amount", false),
      field("rewardAmount", "Mức thưởng", "amount"),
      field("minInclusive", "Gồm cận dưới", "boolean", false),
      field("maxInclusive", "Gồm cận trên", "boolean", false),
      field("priority", "Ưu tiên", "integer", false),
    ],
  },
  {
    template: "PENALTY_RULES",
    label: "Rule phạt",
    fields: [
      field("ruleSetName", "Tên bộ rule", "text"),
      field("versionNo", "Phiên bản", "integer"),
      field("status", "Trạng thái", "ruleStatus"),
      field("effectiveFrom", "Hiệu lực từ", "date", false),
      field("effectiveTo", "Hiệu lực đến", "date", false),
      field("itemCode", "Mã lỗi", "code"),
      field("itemName", "Tên lỗi", "text"),
      field("description", "Mô tả", "text"),
      field("defaultAmount", "Mức phạt", "amount"),
      field("isActive", "Đang dùng", "boolean", false),
      field("displayColor", "Màu hiển thị", "color", false),
      field("displayOrder", "Thứ tự", "integer", false),
    ],
  },
  {
    template: "HISTORICAL_PAYROLL",
    label: "Lương lịch sử",
    fields: [
      field("branchCode", "Mã cơ sở", "code"),
      field("staffCode", "Mã nhân viên", "code"),
      field("month", "Tháng", "date"),
      field("revision", "Lần tính", "integer", false),
      field("workUnits", "Số công", "decimal"),
      field("overtimeMinutes", "Phút tăng ca", "integer", false),
      field("revenueAmount", "Doanh số", "amount", false),
      field("baseSalary", "Lương cơ bản", "amount"),
      field("monthlyRevenueBonus", "Thưởng doanh số", "amount", false),
      field("otherBonus", "Thưởng khác", "amount", false),
      field("penalties", "Tiền phạt", "amount", false),
      field("advance", "Tạm ứng", "amount", false),
      field("totalIncome", "Thực nhận", "amount"),
    ],
  },
] as const;

export type ParsedImportRow = Readonly<{
  sheetName: string;
  rowNumber: number;
  values: Readonly<Record<string, unknown>>;
  formulaColumns: readonly string[];
}>;

export type ParsedImportFile = Readonly<{
  headers: readonly string[];
  rows: readonly ParsedImportRow[];
}>;

export type CanonicalImportRow = Readonly<{
  sheetName: string;
  rowNumber: number;
  values: Readonly<Record<string, string | number | boolean | null>>;
}>;

function templateDefinition(template: ImportTemplate): TemplateDefinition {
  return IMPORT_TEMPLATE_DEFINITIONS.find((item) => item.template === template)!;
}

function cellValue(cell: ExcelJS.Cell): { value: unknown; formula: boolean } {
  const value = cell.value;
  if (value === null || value === undefined) return { value: null, formula: false };
  if (value instanceof Date) return { value: value.toISOString(), formula: false };
  if (typeof value !== "object") return { value, formula: false };
  if ("formula" in value || "sharedFormula" in value) {
    const formula = "formula" in value ? value.formula : value.sharedFormula;
    return { value: `=${String(formula ?? "")}`, formula: true };
  }
  if ("richText" in value && Array.isArray(value.richText)) {
    return {
      value: value.richText.map((part) => ("text" in part ? part.text : "")).join(""),
      formula: false,
    };
  }
  if ("text" in value && typeof value.text === "string") {
    return { value: value.text, formula: false };
  }
  if ("error" in value) return { value: String(value.error), formula: false };
  return { value: String(value), formula: false };
}

export async function parseImportFile(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ParsedImportFile> {
  const workbook = new ExcelJS.Workbook();
  if (mimeType === "text/csv" || mimeType === "application/csv") {
    await workbook.csv.read(Readable.from([Buffer.from(bytes)]));
  } else {
    await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  }
  if (workbook.worksheets.length === 0 || workbook.worksheets.length > MAX_IMPORT_SHEETS) {
    throw new Error(`File phải có từ 1 đến ${MAX_IMPORT_SHEETS} sheet.`);
  }

  const allHeaders: string[] = [];
  const rows: ParsedImportRow[] = [];
  for (const worksheet of workbook.worksheets) {
    if (worksheet.columnCount > MAX_IMPORT_COLUMNS) {
      throw new Error(`Sheet ${worksheet.name} vượt quá ${MAX_IMPORT_COLUMNS} cột.`);
    }
    const headerRow = worksheet.getRow(1);
    const headers = Array.from({ length: worksheet.columnCount }, (_, index) =>
      String(cellValue(headerRow.getCell(index + 1)).value ?? "").trim(),
    );
    const nonEmptyHeaders = headers.filter(Boolean);
    if (nonEmptyHeaders.length === 0) continue;
    if (new Set(nonEmptyHeaders).size !== nonEmptyHeaders.length) {
      throw new Error(`Sheet ${worksheet.name} có tên cột trùng nhau.`);
    }
    for (const header of nonEmptyHeaders) {
      if (!allHeaders.includes(header)) allHeaders.push(header);
    }
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const values: Record<string, unknown> = {};
      const formulaColumns: string[] = [];
      let populated = false;
      headers.forEach((header, index) => {
        if (!header) return;
        const parsed = cellValue(row.getCell(index + 1));
        values[header] = parsed.value;
        if (parsed.formula) formulaColumns.push(header);
        if (parsed.value !== null && String(parsed.value).trim() !== "") populated = true;
      });
      if (populated) {
        rows.push({ sheetName: worksheet.name, rowNumber, values, formulaColumns });
      }
      if (rows.length > MAX_IMPORT_ROWS) {
        throw new Error(`File vượt quá ${MAX_IMPORT_ROWS.toLocaleString("vi-VN")} dòng dữ liệu.`);
      }
    }
  }
  if (allHeaders.length === 0) throw new Error("File không có hàng tiêu đề.");
  return { headers: allHeaders, rows };
}

function rawText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function hasValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return true;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function normalizeDate(value: unknown, includeTime: boolean): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = Math.round((value - 25_569) * 86_400_000);
    const date = new Date(milliseconds);
    if (Number.isNaN(date.getTime())) return null;
    if (!includeTime) return date.toISOString().slice(0, 10);
    const vietnamClock = date.toISOString().replace(/Z$/, "+07:00");
    return new Date(vietnamClock).toISOString();
  }
  const text = rawText(value);
  if (!text) return null;
  const vietnamese = /^(\d{2})\/(\d{2})\/(\d{4})(.*)$/.exec(text);
  const normalized = vietnamese
    ? `${vietnamese[3]}-${vietnamese[2]}-${vietnamese[1]}${vietnamese[4]}`
    : text;
  if (!hasValidCalendarDate(normalized)) return null;
  const localDateTime = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;
  const localMatch = includeTime ? localDateTime.exec(normalized) : null;
  const parseValue =
    includeTime && /^\d{4}-\d{2}-\d{2}$/.test(normalized)
      ? `${normalized}T00:00:00+07:00`
      : localMatch
        ? `${localMatch[1]}T${localMatch[2]}+07:00`
        : normalized;
  const date = new Date(parseValue);
  if (Number.isNaN(date.getTime())) return null;
  return includeTime ? date.toISOString() : date.toISOString().slice(0, 10);
}

function normalizeValue(
  value: unknown,
  definition: FieldDefinition,
): { value: string | number | boolean | null; error?: string } {
  const text = rawText(value);
  if (!text) return { value: null };
  switch (definition.type) {
    case "text":
      return text.length <= 2_000
        ? { value: text }
        : { value: text, error: "Vượt quá 2.000 ký tự." };
    case "code":
      return /^[A-Za-z0-9_.-]+$/.test(text)
        ? { value: text }
        : { value: text, error: "Chỉ được dùng chữ, số, dấu chấm, gạch ngang hoặc gạch dưới." };
    case "boolean": {
      const normalized = text.toLowerCase();
      if (["true", "1", "yes", "y", "có", "co"].includes(normalized)) return { value: true };
      if (["false", "0", "no", "n", "không", "khong"].includes(normalized)) return { value: false };
      return { value: text, error: "Giá trị boolean phải là true/false, yes/no hoặc 1/0." };
    }
    case "date":
    case "datetime": {
      const normalized = normalizeDate(value, definition.type === "datetime");
      return normalized ? { value: normalized } : { value: text, error: "Ngày/giờ không hợp lệ." };
    }
    case "integer":
      return /^\d+$/.test(text) && Number(text) <= Number.MAX_SAFE_INTEGER
        ? { value: Number(text) }
        : { value: text, error: "Phải là số nguyên không âm." };
    case "amount":
      return /^\d+$/.test(text) && BigInt(text) <= 9_223_372_036_854_775_807n
        ? { value: text }
        : { value: text, error: "Phải là số tiền nguyên không âm trong giới hạn BIGINT." };
    case "decimal":
      return /^\d{1,6}(\.\d{1,2})?$/.test(text)
        ? { value: text }
        : { value: text, error: "Phải là số thập phân không âm, tối đa 2 chữ số lẻ." };
    case "color":
      return /^#[0-9A-Fa-f]{6}$/.test(text)
        ? { value: text.toUpperCase() }
        : { value: text, error: "Màu phải có dạng #RRGGBB." };
    case "employmentCategory":
      return ["OFFICIAL", "PROBATION", "CONTRACTOR", "INTERN"].includes(text)
        ? { value: text }
        : { value: text, error: "Loại nhân sự không hợp lệ." };
    case "employmentStatus":
      return ["ACTIVE", "ON_LEAVE", "TERMINATED"].includes(text)
        ? { value: text }
        : { value: text, error: "Trạng thái nhân sự không hợp lệ." };
    case "assignmentType":
      return ["MEMBER", "PRIMARY_MANAGER", "SECONDARY_MANAGER"].includes(text)
        ? { value: text }
        : { value: text, error: "Loại phân công không hợp lệ." };
    case "attendanceStatus":
      return ["DRAFT", "PRESENT", "ABSENT", "LEAVE"].includes(text)
        ? { value: text }
        : { value: text, error: "Trạng thái chấm công không hợp lệ." };
    case "ruleStatus":
      return ["DRAFT", "SCHEDULED", "ACTIVE", "RETIRED"].includes(text)
        ? { value: text }
        : { value: text, error: "Trạng thái rule không hợp lệ." };
  }
}

function error(
  row: Pick<ParsedImportRow, "sheetName" | "rowNumber">,
  columnName: string,
  code: string,
  message: string,
  rawValue: unknown,
  severity: ImportErrorDto["severity"] = "ERROR",
): Omit<ImportErrorDto, "id"> {
  return {
    sheetName: row.sheetName,
    rowNumber: row.rowNumber,
    columnName,
    code,
    message,
    severity,
    rawValue: rawValue === null || rawValue === undefined ? null : String(rawValue).slice(0, 500),
  };
}

export function validateImportStructure(
  parsed: ParsedImportFile,
  template: ImportTemplate,
  mapping: Readonly<Record<string, string>>,
): Readonly<{
  rows: readonly CanonicalImportRow[];
  errors: readonly Omit<ImportErrorDto, "id">[];
}> {
  const definition = templateDefinition(template);
  const errors: Omit<ImportErrorDto, "id">[] = [];
  for (const requiredField of definition.fields.filter((item) => item.required)) {
    if (!mapping[requiredField.key]) {
      errors.push(
        error(
          { sheetName: "Mapping", rowNumber: 1 },
          requiredField.key,
          "MISSING_MAPPING",
          `Chưa map cột bắt buộc “${requiredField.label}”.`,
          null,
          "CRITICAL",
        ),
      );
    }
  }
  for (const [key, source] of Object.entries(mapping)) {
    if (!definition.fields.some((item) => item.key === key) || !parsed.headers.includes(source)) {
      errors.push(
        error(
          { sheetName: "Mapping", rowNumber: 1 },
          key,
          "INVALID_MAPPING",
          `Cột nguồn “${source}” không tồn tại hoặc field đích không hợp lệ.`,
          source,
          "CRITICAL",
        ),
      );
    }
  }

  const rows = parsed.rows.map((row) => {
    const values: Record<string, string | number | boolean | null> = {};
    for (const definitionField of definition.fields) {
      const sourceColumn = mapping[definitionField.key];
      const sourceValue = sourceColumn ? row.values[sourceColumn] : null;
      if (sourceColumn && row.formulaColumns.includes(sourceColumn)) {
        errors.push(
          error(
            row,
            sourceColumn,
            "FORMULA_NOT_ALLOWED",
            "Không chấp nhận ô chứa công thức trong file import.",
            sourceValue,
            "CRITICAL",
          ),
        );
      } else if (
        typeof sourceValue === "string" &&
        (FORMULA_LIKE_TEXT.test(sourceValue) || /^[\t\r]/.test(sourceValue))
      ) {
        errors.push(
          error(
            row,
            sourceColumn ?? definitionField.key,
            "FORMULA_INJECTION",
            "Chuỗi có tiền tố công thức không được phép.",
            sourceValue,
            "CRITICAL",
          ),
        );
      }
      const normalized = normalizeValue(sourceValue, definitionField);
      values[definitionField.key] = normalized.value;
      if (definitionField.required && normalized.value === null) {
        errors.push(
          error(
            row,
            sourceColumn ?? definitionField.key,
            "REQUIRED",
            `${definitionField.label} là bắt buộc.`,
            sourceValue,
          ),
        );
      } else if (normalized.error) {
        errors.push(
          error(
            row,
            sourceColumn ?? definitionField.key,
            "INVALID_VALUE",
            normalized.error,
            sourceValue,
          ),
        );
      }
    }
    const from = values.effectiveFrom;
    const to = values.effectiveTo;
    if (typeof from === "string" && typeof to === "string" && from >= to) {
      errors.push(
        error(
          row,
          mapping.effectiveTo ?? "effectiveTo",
          "INVALID_INTERVAL",
          "Cận đến phải sau cận từ.",
          to,
        ),
      );
    }
    if (
      template === "ATTENDANCE_LIVE" &&
      typeof values.checkInAt === "string" &&
      typeof values.checkOutAt === "string" &&
      values.checkOutAt <= values.checkInAt &&
      values.spansNextDay !== true
    ) {
      errors.push(
        error(
          row,
          mapping.checkOutAt ?? "checkOutAt",
          "CHECKOUT_BEFORE_CHECKIN",
          "Check-out phải sau check-in hoặc phải đánh dấu qua ngày.",
          values.checkOutAt,
        ),
      );
    }
    return { sheetName: row.sheetName, rowNumber: row.rowNumber, values };
  });
  return { rows, errors };
}

export function defaultImportMapping(
  template: ImportTemplate,
  headers: readonly string[],
): Readonly<Record<string, string>> {
  const normalizedHeaders = new Map(headers.map((header) => [header.toLowerCase().trim(), header]));
  return Object.fromEntries(
    templateDefinition(template).fields.flatMap((definition) => {
      const exact = normalizedHeaders.get(definition.key.toLowerCase());
      const label = normalizedHeaders.get(definition.label.toLowerCase());
      const source = exact ?? label;
      return source ? [[definition.key, source]] : [];
    }),
  );
}
