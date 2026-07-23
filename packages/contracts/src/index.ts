import { AUTH_ROLES } from "@ald/domain";
import { z } from "zod";

const trimmedText = (label: string, max: number) =>
  z.string().trim().min(1, `${label} là bắt buộc.`).max(max);

export const idSchema = z.uuid();
export const reasonSchema = trimmedText("Lý do", 500);

export const branchCreateSchema = z.object({
  code: trimmedText("Mã cơ sở", 30).regex(/^[A-Za-z0-9_-]+$/),
  name: trimmedText("Tên cơ sở", 120),
  address: z.string().trim().max(500).optional(),
  reason: reasonSchema,
});

export const branchUpdateSchema = branchCreateSchema
  .omit({ code: true })
  .partial({ name: true, address: true })
  .extend({
    isActive: z.boolean().optional(),
    version: z.number().int().positive(),
    reason: reasonSchema,
  });

export const staffCreateSchema = z.object({
  staffCode: trimmedText("Mã nhân viên", 30).regex(/^[A-Za-z0-9_-]+$/),
  fullName: trimmedText("Họ tên", 120),
  streamingAlias: z.string().trim().max(120).nullable().optional(),
  email: z.email().optional(),
  phone: z.string().trim().max(30).optional(),
  jobTitle: trimmedText("Vị trí công việc", 120),
  employmentCategory: z.enum(["OFFICIAL", "PROBATION", "CONTRACTOR", "INTERN"]),
  reason: reasonSchema,
});

export const staffUpdateSchema = staffCreateSchema
  .omit({ staffCode: true })
  .partial()
  .extend({
    employmentStatus: z.enum(["ACTIVE", "ON_LEAVE", "TERMINATED"]).optional(),
    version: z.number().int().positive(),
    reason: reasonSchema,
  });

export const assignmentCreateSchema = z
  .object({
    staffId: idSchema,
    branchId: idSchema,
    assignmentType: z.enum(["MEMBER", "PRIMARY_MANAGER", "SECONDARY_MANAGER"]),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().nullable().optional(),
    reason: reasonSchema,
  })
  .refine(
    ({ effectiveFrom, effectiveTo }) => !effectiveTo || effectiveFrom < effectiveTo,
    "Ngày kết thúc phải sau ngày bắt đầu.",
  );

export const assignmentUpdateSchema = z
  .object({
    effectiveTo: z.iso.date().nullable(),
    version: z.number().int().positive(),
    reason: reasonSchema,
  })
  .refine(() => true);

export const userCreateSchema = z.object({
  email: z.email(),
  username: trimmedText("Tên đăng nhập", 30).regex(/^[A-Za-z0-9_.]+$/),
  password: z.string().min(12).max(128),
  name: trimmedText("Tên hiển thị", 120),
  role: z.enum(AUTH_ROLES),
  staffId: idSchema.nullable().optional(),
  reason: reasonSchema,
});

export const userUpdateSchema = z.object({
  role: z.enum(AUTH_ROLES).optional(),
  active: z.boolean().optional(),
  version: z.number().int().positive(),
  reason: reasonSchema,
});

export const loginSchema = z.object({
  identifier: trimmedText("Email hoặc tên đăng nhập", 320),
  password: z.string().min(1).max(128),
});

export const businessMonthSchema = z
  .string()
  .regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/, "Tháng phải có định dạng YYYY-MM.");

const workUnitsSchema = z
  .string()
  .trim()
  .regex(/^\d{1,2}(\.\d{1,2})?$/, "Số công phải là số không âm, tối đa 2 chữ số thập phân.")
  .refine((value) => Number(value) <= 10, "Số công không được vượt quá 10.");

const revenueAmountSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, "Doanh số phải là số nguyên không âm.")
  .refine(
    (value) => BigInt(value) <= 9_223_372_036_854_775_807n,
    "Doanh số vượt giới hạn lưu trữ.",
  );

const penaltyAmountSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, "Tiền phạt phải là số nguyên không âm.")
  .refine(
    (value) => BigInt(value) <= 9_223_372_036_854_775_807n,
    "Tiền phạt vượt giới hạn lưu trữ.",
  );

const jsonObjectSchema = z.record(z.string(), z.unknown());

const attendanceValuesSchema = z.object({
  checkInAt: z.iso.datetime({ offset: true }).nullable().optional(),
  checkOutAt: z.iso.datetime({ offset: true }).nullable().optional(),
  spansNextDay: z.boolean().optional(),
  workUnits: workUnitsSchema.optional(),
  overtimeMinutes: z.number().int().min(0).max(2_880).optional(),
  note: z.string().trim().max(2_000).nullable().optional(),
  status: z.enum(["DRAFT", "PRESENT", "ABSENT", "LEAVE"]).optional(),
  actualLiveMinutes: z.number().int().min(0).max(2_880).optional(),
  revenueAmount: revenueAmountSchema.optional(),
});

export const attendanceCreateSchema = attendanceValuesSchema.extend({
  staffId: idSchema,
  businessDate: z.iso.date(),
  reason: reasonSchema,
});

export const attendanceUpdateSchema = attendanceValuesSchema.extend({
  version: z.number().int().positive(),
  reason: reasonSchema,
});

export const attendanceArchiveSchema = z.object({
  version: z.number().int().positive(),
  reason: reasonSchema,
});

export const attendanceMonthQuerySchema = z.object({
  staffId: idSchema,
  month: businessMonthSchema,
});

export const branchOverviewQuerySchema = z.object({
  branchId: idSchema,
  month: businessMonthSchema,
  employmentStatus: z.enum(["ACTIVE", "ON_LEAVE", "TERMINATED"]).optional(),
  employmentCategory: z.enum(["OFFICIAL", "PROBATION", "CONTRACTOR", "INTERN"]).optional(),
  levelId: idSchema.optional(),
  search: z.string().trim().max(120).optional(),
});

export const branchOverviewCellEditSchema = z
  .object({
    clientId: trimmedText("Mã ô", 80),
    staffId: idSchema,
    businessDate: z.iso.date(),
    version: z.number().int().positive().nullable(),
    revenueAmount: revenueAmountSchema.optional(),
    actualLiveMinutes: z.number().int().min(0).max(2_880).optional(),
    workUnits: workUnitsSchema.optional(),
    overtimeMinutes: z.number().int().min(0).max(2_880).optional(),
  })
  .refine(
    ({ revenueAmount, actualLiveMinutes, workUnits, overtimeMinutes }) =>
      revenueAmount !== undefined ||
      actualLiveMinutes !== undefined ||
      workUnits !== undefined ||
      overtimeMinutes !== undefined,
    "Mỗi ô cập nhật phải có ít nhất một giá trị.",
  );

export const branchOverviewBatchUpdateSchema = z.object({
  branchId: idSchema,
  reason: reasonSchema,
  edits: z.array(branchOverviewCellEditSchema).min(1).max(200),
});

export const penaltyRuleSetCreateSchema = z.object({
  name: trimmedText("Tên bộ rule", 120),
  reason: reasonSchema,
});

export const penaltyRuleDraftCreateSchema = z.object({
  ruleSetId: idSchema,
  cloneFromVersionId: idSchema.nullable().optional(),
  notes: z.string().trim().max(2_000).nullable().optional(),
  reason: reasonSchema,
});

export const penaltyItemInputSchema = z.object({
  code: trimmedText("Mã lỗi", 40)
    .regex(/^[A-Za-z0-9_-]+$/, "Mã lỗi chỉ gồm chữ, số, gạch ngang hoặc gạch dưới.")
    .transform((value) => value.toUpperCase()),
  name: trimmedText("Tên lỗi", 160),
  description: trimmedText("Mô tả lỗi", 2_000),
  defaultAmount: penaltyAmountSchema,
  reminderPolicy: jsonObjectSchema.nullable().optional(),
  metadata: jsonObjectSchema.nullable().optional(),
  isActive: z.boolean().default(true),
  displayColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Màu phải có định dạng #RRGGBB.")
    .transform((value) => value.toUpperCase()),
  displayOrder: z.number().int().min(0).max(10_000),
});

export const penaltyRuleDraftUpdateSchema = z
  .object({
    notes: z.string().trim().max(2_000).nullable(),
    items: z.array(penaltyItemInputSchema).max(200),
    rowVersion: z.number().int().positive(),
    reason: reasonSchema,
  })
  .superRefine(({ items }, context) => {
    const codes = new Set<string>();
    for (const item of items) {
      if (codes.has(item.code)) {
        context.addIssue({
          code: "custom",
          message: `Mã lỗi ${item.code} bị trùng trong cùng version.`,
          path: ["items"],
        });
      }
      codes.add(item.code);
    }
  });

export const penaltyRulePublishSchema = z
  .object({
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().nullable(),
    rowVersion: z.number().int().positive(),
    reason: reasonSchema,
  })
  .refine(
    ({ effectiveFrom, effectiveTo }) => !effectiveTo || effectiveFrom < effectiveTo,
    "Ngày kết thúc phải sau ngày bắt đầu.",
  );

export const penaltyRuleRetireSchema = z.object({
  effectiveTo: z.iso.date(),
  rowVersion: z.number().int().positive(),
  reason: reasonSchema,
});

export const activePenaltyRuleQuerySchema = z.object({
  date: z.iso.date(),
});

export const penaltyRuleCompareQuerySchema = z.object({
  fromVersionId: idSchema,
  toVersionId: idSchema,
});

export const violationCreateSchema = z
  .object({
    attendanceId: idSchema,
    penaltyItemId: idSchema,
    detail: trimmedText("Chi tiết thực tế", 2_000),
    note: z.string().trim().max(2_000).nullable().optional(),
    amountOverride: penaltyAmountSchema.nullable().optional(),
    overrideReason: reasonSchema.nullable().optional(),
    reason: reasonSchema,
  })
  .superRefine(({ amountOverride, overrideReason }, context) => {
    if (amountOverride !== undefined && amountOverride !== null && !overrideReason) {
      context.addIssue({
        code: "custom",
        message: "Override tiền phạt bắt buộc có lý do.",
        path: ["overrideReason"],
      });
    }
  });

export const violationCancelSchema = z.object({
  version: z.number().int().positive(),
  reason: reasonSchema,
});

export const evidencePresignSchema = z.object({
  violationId: idSchema,
  originalFileName: trimmedText("Tên file", 255),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1_024 * 1_024),
  checksumSha256: z
    .string()
    .regex(/^[A-Za-z0-9+/]{43}=$/, "Checksum SHA-256 phải là base64 hợp lệ."),
  reason: reasonSchema,
});

export const evidenceCompleteSchema = z.object({
  version: z.number().int().positive(),
});

export type EvidenceDto = Readonly<{
  id: string;
  originalFileName: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: string;
  checksumSha256: string;
  status: "PENDING_UPLOAD" | "READY" | "REJECTED" | "CANCELLED";
  version: number;
}>;

export type ViolationDto = Readonly<{
  id: string;
  attendanceId: string;
  businessDate: string;
  penaltyItemId: string;
  ruleVersionId: string;
  itemName: string;
  amount: string;
  detail: string;
  note: string | null;
  overrideReason: string | null;
  status: "ACTIVE" | "CANCELLED";
  version: number;
  displayColor: string;
  evidence: readonly EvidenceDto[];
}>;

export type PenaltyItemDto = Readonly<{
  id: string;
  code: string;
  name: string;
  description: string;
  defaultAmount: string;
  reminderPolicy: Readonly<Record<string, unknown>> | null;
  metadata: Readonly<Record<string, unknown>> | null;
  isActive: boolean;
  displayColor: string;
  displayOrder: number;
}>;

export type PenaltyRuleVersionDto = Readonly<{
  id: string;
  ruleSetId: string;
  versionNo: number;
  status: "DRAFT" | "SCHEDULED" | "ACTIVE" | "RETIRED";
  effectiveStatus: "DRAFT" | "SCHEDULED" | "ACTIVE" | "RETIRED";
  effectiveFrom: string | null;
  effectiveTo: string | null;
  notes: string | null;
  rowVersion: number;
  clonedFromVersionId: string | null;
  createdAt: string;
  publishedAt: string | null;
  items: readonly PenaltyItemDto[];
}>;

export type PenaltyRuleSetDto = Readonly<{
  id: string;
  name: string;
  type: "PENALTY";
  version: number;
  versions: readonly PenaltyRuleVersionDto[];
}>;

export type PenaltyRuleComparisonDto = Readonly<{
  fromVersionId: string;
  toVersionId: string;
  addedCodes: readonly string[];
  removedCodes: readonly string[];
  changedCodes: readonly string[];
}>;

export type AttendanceRecordDto = Readonly<{
  id: string;
  staffId: string;
  branchId: string;
  businessDate: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  spansNextDay: boolean;
  workUnits: string;
  overtimeMinutes: number;
  note: string | null;
  status: "DRAFT" | "PRESENT" | "ABSENT" | "LEAVE";
  version: number;
  archivedAt: string | null;
  actualLiveMinutes: number;
  revenueAmount: string;
  revenueUnit: "VND" | "THOUSAND_VND";
  revenueScale: number;
}>;

export type AttendanceMonthDayDto = Readonly<{
  businessDate: string;
  dayOfWeek: number;
  attendance: AttendanceRecordDto | null;
  violations: readonly ViolationDto[];
  activePenaltyTotal: string;
}>;

export type AttendanceMonthDto = Readonly<{
  month: string;
  activePenaltyTotal: string;
  staff: Readonly<{
    id: string;
    staffCode: string;
    fullName: string;
    jobTitle: string;
  }>;
  revenueConfig: Readonly<{
    unit: "VND" | "THOUSAND_VND";
    scale: number;
  }>;
  days: readonly AttendanceMonthDayDto[];
}>;

export type BranchOverviewDayDto = Readonly<{
  businessDate: string;
  dayOfWeek: number;
  weekOfMonth: number;
  attendanceId: string | null;
  version: number | null;
  archivedAt: string | null;
  status: "DRAFT" | "PRESENT" | "ABSENT" | "LEAVE" | null;
  revenueAmount: string;
  actualLiveMinutes: number;
  workUnits: string;
  overtimeMinutes: number;
  penaltyAmount: string;
}>;

export type BranchOverviewTotalsDto = Readonly<{
  revenueAmount: string;
  workUnits: string;
  actualLiveMinutes: number;
  overtimeMinutes: number;
  penaltyAmount: string;
}>;

export type BranchOverviewRowDto = Readonly<{
  staff: Readonly<{
    id: string;
    staffCode: string;
    fullName: string;
    streamingAlias: string | null;
    employmentCategory: "OFFICIAL" | "PROBATION" | "CONTRACTOR" | "INTERN";
    employmentStatus: "ACTIVE" | "ON_LEAVE" | "TERMINATED";
    performanceLevel: Readonly<{
      id: string;
      code: string;
      name: string;
    }> | null;
  }>;
  days: readonly BranchOverviewDayDto[];
  totals: BranchOverviewTotalsDto;
}>;

export type BranchMonthlyOverviewDto = Readonly<{
  month: string;
  branch: Readonly<{ id: string; code: string; name: string }>;
  revenueConfig: Readonly<{
    unit: "VND" | "THOUSAND_VND";
    scale: number;
  }>;
  calendar: readonly Readonly<{
    businessDate: string;
    dayOfWeek: number;
    weekOfMonth: number;
  }>[];
  levels: readonly Readonly<{
    id: string;
    code: string;
    name: string;
  }>[];
  rows: readonly BranchOverviewRowDto[];
  totals: BranchOverviewTotalsDto;
}>;

export type BranchOverviewCellResultDto = Readonly<{
  clientId: string;
  status: "SAVED" | "CONFLICT" | "ERROR";
  attendance: AttendanceRecordDto | null;
  message: string | null;
}>;

export type EmployeeErrorReportDto = Readonly<{
  reportType: "EMPLOYEE_ERROR_REPORT";
  month: string;
  generatedAt: string;
  staff: Readonly<{
    id: string;
    staffCode: string;
    fullName: string;
  }>;
  attendance: readonly Readonly<{
    businessDate: string;
    status: "DRAFT" | "PRESENT" | "ABSENT" | "LEAVE";
    workUnits: string;
    overtimeMinutes: number;
    note: string | null;
  }>[];
  violations: readonly Readonly<{
    businessDate: string;
    attendance: Readonly<{
      status: "DRAFT" | "PRESENT" | "ABSENT" | "LEAVE";
      workUnits: string;
      overtimeMinutes: number;
      note: string | null;
    }>;
    itemName: string;
    detail: string;
    amount: string;
    note: string | null;
    evidence: readonly Readonly<{
      fileName: string;
      mimeType: string;
      url: string;
    }>[];
  }>[];
}>;

export type BranchCreateInput = z.infer<typeof branchCreateSchema>;
export type BranchUpdateInput = z.infer<typeof branchUpdateSchema>;
export type StaffCreateInput = z.infer<typeof staffCreateSchema>;
export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>;
export type AssignmentCreateInput = z.infer<typeof assignmentCreateSchema>;
export type AssignmentUpdateInput = z.infer<typeof assignmentUpdateSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type AttendanceCreateInput = z.infer<typeof attendanceCreateSchema>;
export type AttendanceUpdateInput = z.infer<typeof attendanceUpdateSchema>;
export type AttendanceArchiveInput = z.infer<typeof attendanceArchiveSchema>;
export type AttendanceMonthQuery = z.infer<typeof attendanceMonthQuerySchema>;
export type BranchOverviewQuery = z.infer<typeof branchOverviewQuerySchema>;
export type BranchOverviewCellEditInput = z.infer<typeof branchOverviewCellEditSchema>;
export type BranchOverviewBatchUpdateInput = z.infer<typeof branchOverviewBatchUpdateSchema>;
export type PenaltyRuleSetCreateInput = z.infer<typeof penaltyRuleSetCreateSchema>;
export type PenaltyRuleDraftCreateInput = z.infer<typeof penaltyRuleDraftCreateSchema>;
export type PenaltyRuleDraftUpdateInput = z.infer<typeof penaltyRuleDraftUpdateSchema>;
export type PenaltyRulePublishInput = z.infer<typeof penaltyRulePublishSchema>;
export type PenaltyRuleRetireInput = z.infer<typeof penaltyRuleRetireSchema>;
export type ViolationCreateInput = z.infer<typeof violationCreateSchema>;
export type ViolationCancelInput = z.infer<typeof violationCancelSchema>;
export type EvidencePresignInput = z.infer<typeof evidencePresignSchema>;
export type EvidenceCompleteInput = z.infer<typeof evidenceCompleteSchema>;
