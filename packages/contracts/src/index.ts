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

const strongPasswordSchema = z
  .string()
  .min(12, "Mật khẩu phải có ít nhất 12 ký tự.")
  .max(128)
  .regex(/[a-z]/, "Mật khẩu phải có chữ thường.")
  .regex(/[A-Z]/, "Mật khẩu phải có chữ hoa.")
  .regex(/[0-9]/, "Mật khẩu phải có chữ số.")
  .regex(/[^A-Za-z0-9]/, "Mật khẩu phải có ký tự đặc biệt.")
  .refine((value) => !/\s/.test(value), "Mật khẩu không được chứa khoảng trắng.");

export const userCreateSchema = z.object({
  email: z.email(),
  username: trimmedText("Tên đăng nhập", 30).regex(/^[A-Za-z0-9_.]+$/),
  password: strongPasswordSchema,
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

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: strongPasswordSchema,
  })
  .refine(({ currentPassword, newPassword }) => currentPassword !== newPassword, {
    message: "Mật khẩu mới phải khác mật khẩu hiện tại.",
    path: ["newPassword"],
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

export const companyReportQuerySchema = z.object({
  month: businessMonthSchema,
  branchId: idSchema.optional(),
  employmentStatus: z.enum(["ACTIVE", "ON_LEAVE", "TERMINATED"]).optional(),
  employmentCategory: z.enum(["OFFICIAL", "PROBATION", "CONTRACTOR", "INTERN"]).optional(),
  levelId: idSchema.optional(),
});

export const companyReportExportQuerySchema = companyReportQuerySchema.extend({
  format: z.enum(["xlsx", "pdf"]),
});

export const companyDashboardQuerySchema = z.object({
  month: businessMonthSchema,
  branchId: idSchema.optional(),
});

const kpiScoreSchema = z
  .string()
  .trim()
  .regex(/^\d{1,5}(\.\d{1,2})?$/, "Điểm KPI phải là số không âm, tối đa 2 số lẻ.");

export const managerKpiListQuerySchema = z.object({
  month: businessMonthSchema.optional(),
  managerStaffId: idSchema.optional(),
});

export const managerKpiCreateSchema = z.object({
  managerStaffId: idSchema,
  month: businessMonthSchema,
  notes: z.string().trim().max(2_000).nullable().optional(),
  reason: reasonSchema,
});

export const managerKpiUpdateSchema = z.object({
  version: z.number().int().positive(),
  notes: z.string().trim().max(2_000).nullable(),
  criteria: z
    .array(
      z.object({
        code: trimmedText("Mã tiêu chí", 40),
        score: kpiScoreSchema,
        note: z.string().trim().max(2_000).nullable(),
        evidence: z.string().trim().max(4_000).nullable(),
      }),
    )
    .min(1)
    .max(200),
  reason: reasonSchema,
});

export const managerKpiPublishSchema = z.object({
  version: z.number().int().positive(),
  reason: reasonSchema,
});

export const managerKpiSettingUpdateSchema = z.object({
  enabled: z.boolean(),
  version: z.number().int().positive(),
  reason: reasonSchema,
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

export const CONFIGURED_RULE_TYPES = [
  "DAILY_REWARD_TIERS",
  "MONTHLY_LEVEL_RULES",
  "SALARY_RULES",
  "KPI_TEMPLATE",
] as const;

export const configuredRuleTypeSchema = z.enum(CONFIGURED_RULE_TYPES);

const moneyAmountSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, "Số tiền phải là số nguyên không âm.")
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n, "Số tiền vượt giới hạn lưu trữ.");

const positiveDecimalSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Giá trị phải là số không âm, tối đa 2 chữ số thập phân.");

const ruleCodeSchema = trimmedText("Mã rule", 40)
  .regex(/^[A-Za-z0-9_-]+$/, "Mã chỉ gồm chữ, số, gạch ngang hoặc gạch dưới.")
  .transform((value) => value.toUpperCase());

const gapPolicySchema = z.enum(["REQUIRE_CONTIGUOUS", "ALLOW_GAPS"]);

export const revenueTierSchema = z
  .object({
    code: ruleCodeSchema,
    name: trimmedText("Tên bậc", 160),
    minRevenue: moneyAmountSchema,
    maxRevenue: moneyAmountSchema.nullable(),
    minInclusive: z.boolean(),
    maxInclusive: z.boolean(),
    rewardAmount: moneyAmountSchema,
    priority: z.number().int().min(0).max(10_000),
  })
  .strict();

export const dailyRewardConfigSchema = z
  .object({
    kind: z.literal("DAILY_REWARD_TIERS"),
    gapPolicy: gapPolicySchema,
    tiers: z.array(revenueTierSchema).min(1).max(200),
  })
  .strict();

export const monthlyLevelTierSchema = z
  .object({
    code: ruleCodeSchema,
    name: trimmedText("Tên level", 160),
    displayOrder: z.number().int().min(0).max(10_000),
    minRevenue: moneyAmountSchema,
    maxRevenue: moneyAmountSchema.nullable(),
    minInclusive: z.boolean(),
    maxInclusive: z.boolean(),
    monthlyRevenueBonus: moneyAmountSchema,
    attendanceBonus: moneyAmountSchema,
    achievementBonus: moneyAmountSchema,
    retainLevelBonus: moneyAmountSchema,
    jumpLevelBonus: moneyAmountSchema,
    attendanceMinWorkUnits: positiveDecimalSchema.nullable(),
    achievementMinLiveMinutes: z.number().int().min(0).max(100_000).nullable(),
    jumpMinLevelSteps: z.number().int().min(1).max(100),
  })
  .strict();

export const monthlyLevelConfigSchema = z
  .object({
    kind: z.literal("MONTHLY_LEVEL_RULES"),
    gapPolicy: gapPolicySchema,
    levels: z.array(monthlyLevelTierSchema).min(1).max(100),
  })
  .strict();

export const salaryConfigSchema = z
  .object({
    kind: z.literal("SALARY_RULES"),
    baseSalary: moneyAmountSchema,
    standardWorkdays: positiveDecimalSchema,
    standardDailyMinutes: z.number().int().min(1).max(1_440),
    overtime: z
      .object({
        multiplierBps: z.number().int().min(0).max(100_000),
        eligibleAfterMinutes: z.number().int().min(0).max(10_000),
      })
      .strict(),
    attendancePolicy: z
      .object({
        eligibleStatuses: z
          .array(z.enum(["DRAFT", "PRESENT", "ABSENT", "LEAVE"]))
          .min(1)
          .max(4),
        prorateMode: z.enum(["WORK_UNITS", "PRESENT_DAYS"]),
        minimumWorkUnitsForFullSalary: positiveDecimalSchema.nullable(),
        capAtStandardWorkdays: z.boolean(),
      })
      .strict(),
    roundingPolicy: z
      .object({
        unit: z.union([z.literal(1), z.literal(10), z.literal(100), z.literal(1_000)]),
        mode: z.enum(["HALF_UP", "HALF_EVEN", "FLOOR", "CEILING"]),
        applyAt: z.enum(["COMPONENT", "TOTAL"]),
      })
      .strict(),
  })
  .strict();

export const kpiCriterionSchema = z
  .object({
    code: ruleCodeSchema,
    name: trimmedText("Tên tiêu chí", 160),
    description: z.string().trim().max(2_000),
    weightBps: z.number().int().min(1).max(10_000),
    maxScore: z.number().int().min(1).max(10_000),
    requiredEvidence: z.boolean(),
    requiredNote: z.boolean(),
    displayOrder: z.number().int().min(0).max(10_000),
  })
  .strict();

export const kpiTemplateConfigSchema = z
  .object({
    kind: z.literal("KPI_TEMPLATE"),
    criteria: z.array(kpiCriterionSchema).min(1).max(200),
  })
  .strict();

export const configuredRuleSchema = z.discriminatedUnion("kind", [
  dailyRewardConfigSchema,
  monthlyLevelConfigSchema,
  salaryConfigSchema,
  kpiTemplateConfigSchema,
]);

export const configuredRuleSetCreateSchema = z.object({
  name: trimmedText("Tên bộ rule", 120),
  type: configuredRuleTypeSchema,
  reason: reasonSchema,
});

export const configuredRuleDraftCreateSchema = z.object({
  ruleSetId: idSchema,
  cloneFromVersionId: idSchema.nullable().optional(),
  notes: z.string().trim().max(2_000).nullable().optional(),
  reason: reasonSchema,
});

export const configuredRuleDraftUpdateSchema = z.object({
  configuration: configuredRuleSchema,
  notes: z.string().trim().max(2_000).nullable(),
  rowVersion: z.number().int().positive(),
  reason: reasonSchema,
});

export const activeConfiguredRuleQuerySchema = z.object({
  date: z.iso.date(),
  type: configuredRuleTypeSchema.optional(),
});

export const configuredRuleCompareQuerySchema = z.object({
  fromVersionId: idSchema,
  toVersionId: idSchema,
});

export const ruleImpactPreviewSchema = z.object({
  ruleVersionId: idSchema,
  month: businessMonthSchema,
});

export const levelProposalGenerateSchema = z.object({
  month: businessMonthSchema,
  reason: reasonSchema,
});

export const levelProposalListQuerySchema = z.object({
  month: businessMonthSchema,
});

export const levelProposalConfirmSchema = z.object({
  version: z.number().int().positive(),
  performanceLevelId: idSchema.nullable().optional(),
  reason: reasonSchema,
});

const signedMoneyAmountSchema = z
  .string()
  .trim()
  .regex(/^-?\d+$/, "Số tiền phải là số nguyên VND.")
  .refine((value) => {
    const amount = BigInt(value);
    return amount >= -9_223_372_036_854_775_808n && amount <= 9_223_372_036_854_775_807n;
  }, "Số tiền vượt giới hạn lưu trữ.");

export const payrollPeriodListQuerySchema = z.object({
  branchId: idSchema.optional(),
  month: businessMonthSchema.optional(),
});

export const payrollPeriodCreateSchema = z.object({
  branchId: idSchema,
  month: businessMonthSchema,
  reason: reasonSchema,
});

export const payrollPeriodActionSchema = z.object({
  version: z.number().int().positive(),
  reason: reasonSchema,
});

export const payrollRevisionCreateSchema = z.object({
  reason: reasonSchema,
});

export const payrollAdjustmentCreateSchema = z
  .object({
    staffId: idSchema,
    type: z.enum(["OTHER_BONUS", "ADVANCE", "CORRECTION"]),
    amount: signedMoneyAmountSchema,
    reason: reasonSchema,
    sourceDocument: z.string().trim().max(500).nullable().optional(),
    periodVersion: z.number().int().positive(),
  })
  .superRefine(({ amount, type }, context) => {
    if (type !== "CORRECTION" && BigInt(amount) < 0n) {
      context.addIssue({
        code: "custom",
        message: "Thưởng khác và tạm ứng không được âm.",
        path: ["amount"],
      });
    }
  });

export const payrollExportCreateSchema = z
  .object({
    kind: z.enum(["PAYSLIP_XLSX", "PAYSLIP_PDF", "BULK_ZIP"]),
    staffId: idSchema.nullable().optional(),
    reason: reasonSchema,
  })
  .superRefine(({ kind, staffId }, context) => {
    if (kind !== "BULK_ZIP" && !staffId) {
      context.addIssue({
        code: "custom",
        message: "Export cá nhân phải chọn nhân viên.",
        path: ["staffId"],
      });
    }
    if (kind === "BULK_ZIP" && staffId) {
      context.addIssue({
        code: "custom",
        message: "Bulk ZIP không nhận staffId.",
        path: ["staffId"],
      });
    }
  });

export type PayrollStatus = "DRAFT" | "CALCULATED" | "REVIEWED" | "LOCKED" | "PUBLISHED";

export type PayrollLineDto = Readonly<{
  id: string;
  type:
    | "BASE_SALARY"
    | "PRORATED_SALARY"
    | "DAILY_REVENUE_BONUS"
    | "MONTHLY_REVENUE_BONUS"
    | "ATTENDANCE_BONUS"
    | "ACHIEVEMENT_BONUS"
    | "LEVEL_BONUS"
    | "OVERTIME_PAY"
    | "OTHER_BONUS"
    | "PENALTY"
    | "ADVANCE"
    | "TOTAL_INCOME";
  amount: string;
  sourceType: string;
  sourceId: string;
  ruleVersionId: string | null;
  label: string;
  calculationDetails: Readonly<Record<string, unknown>>;
  includedInTotal: boolean;
}>;

export type PayrollDailyRowDto = Readonly<{
  businessDate: string;
  status: "DRAFT" | "PRESENT" | "ABSENT" | "LEAVE";
  workUnits: string;
  overtimeMinutes: number;
  actualLiveMinutes: number;
  revenueAmount?: string;
  dailyRevenueBonus: string;
  penalties: string;
}>;

export type PayrollEntryDto = Readonly<{
  id: string;
  staff: Readonly<{
    id: string;
    staffCode: string;
    fullName: string;
    streamingAlias: string | null;
  }>;
  workUnits: string;
  overtimeMinutes: number;
  revenueAmount?: string;
  actualLiveMinutes: number;
  baseSalary: string;
  proratedSalary: string;
  dailyRevenueBonus: string;
  monthlyRevenueBonus: string;
  attendanceBonus: string;
  achievementBonus: string;
  levelBonus: string;
  overtimePay: string;
  otherBonus: string;
  penalties: string;
  advance: string;
  totalIncome: string;
  anomalyFlags: readonly string[];
  calculationHash: string;
  calculationNo: number;
  lines: readonly PayrollLineDto[];
  dailyRows: readonly PayrollDailyRowDto[];
  previousTotalIncome: string | null;
  deltaFromPrevious: string | null;
}>;

export type PayrollPeriodDto = Readonly<{
  id: string;
  branch: Readonly<{ id: string; code: string; name: string }>;
  month: string;
  revision: number;
  status: PayrollStatus;
  version: number;
  sourcePeriodId: string | null;
  latestCalculationNo: number;
  totals: Readonly<{
    staffCount: number;
    grossIncome: string;
    penalties: string;
    advance: string;
    totalIncome: string;
  }>;
  calculatedAt: string | null;
  reviewedAt: string | null;
  lockedAt: string | null;
  publishedAt: string | null;
  entries: readonly PayrollEntryDto[];
}>;

export type PayrollExportJobDto = Readonly<{
  id: string;
  periodId: string;
  staffId: string | null;
  kind: "PAYSLIP_XLSX" | "PAYSLIP_PDF" | "BULK_ZIP";
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  progress: number;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}>;

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

export type ConfiguredRuleType = (typeof CONFIGURED_RULE_TYPES)[number];
export type DailyRewardConfig = z.infer<typeof dailyRewardConfigSchema>;
export type MonthlyLevelConfig = z.infer<typeof monthlyLevelConfigSchema>;
export type SalaryConfig = z.infer<typeof salaryConfigSchema>;
export type KpiTemplateConfig = z.infer<typeof kpiTemplateConfigSchema>;
export type ConfiguredRule = z.infer<typeof configuredRuleSchema>;

export type ConfiguredRuleVersionDto = Readonly<{
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
  configuration: ConfiguredRule;
}>;

export type ConfiguredRuleSetDto = Readonly<{
  id: string;
  name: string;
  type: ConfiguredRuleType;
  version: number;
  versions: readonly ConfiguredRuleVersionDto[];
}>;

export type ConfiguredRuleComparisonDto = Readonly<{
  fromVersionId: string;
  toVersionId: string;
  changedPaths: readonly string[];
}>;

export type RuleImpactPreviewDto = Readonly<{
  ruleVersionId: string;
  baselineVersionId: string | null;
  month: string;
  metric: "PROJECTED_AMOUNT_VND" | "MAX_KPI_SCORE";
  rows: readonly Readonly<{
    staffId: string;
    staffCode: string;
    fullName: string;
    baselineValue: string;
    draftValue: string;
    delta: string;
    details: Readonly<Record<string, string | number | boolean | null>>;
  }>[];
  totals: Readonly<{
    baselineValue: string;
    draftValue: string;
    delta: string;
  }>;
}>;

export type LevelProposalDto = Readonly<{
  id: string;
  sourceMonth: string;
  effectiveFrom: string;
  monthlyRevenue: string;
  status: "PENDING" | "CONFIRMED" | "OVERRIDDEN";
  version: number;
  decisionReason: string | null;
  staff: Readonly<{ id: string; staffCode: string; fullName: string }>;
  suggestedLevel: Readonly<{ id: string; code: string; name: string; displayOrder: number }>;
  confirmedLevel: Readonly<{
    id: string;
    code: string;
    name: string;
    displayOrder: number;
  }> | null;
}>;

export type PerformanceLevelOptionDto = Readonly<{
  id: string;
  code: string;
  name: string;
  displayOrder: number;
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

export type CompanyReportTotalsDto = Readonly<{
  revenueAmount: string;
  revenueBonus: string;
  monthlyBonus: string;
  baseSalary: string;
  totalIncome: string;
  workUnits: string;
  penalties: string;
}>;

export type CompanyReportStaffRowDto = Readonly<{
  staff: Readonly<{
    id: string;
    staffCode: string;
    fullName: string;
    employmentCategory: "OFFICIAL" | "PROBATION" | "CONTRACTOR" | "INTERN";
    employmentStatus: "ACTIVE" | "ON_LEAVE" | "TERMINATED";
    performanceLevel: Readonly<{ id: string; code: string; name: string }> | null;
  }>;
  weeks: readonly Readonly<{ weekNo: number; revenueAmount: string }>[];
  payrollStatus: PayrollStatus | null;
  payrollRevision: number | null;
  totals: CompanyReportTotalsDto;
}>;

export type CompanyMonthlyReportDto = Readonly<{
  month: string;
  generatedAt: string;
  weeks: readonly Readonly<{ weekNo: number; from: string; to: string }>[];
  branches: readonly Readonly<{
    branch: Readonly<{ id: string; code: string; name: string }>;
    payrollStatus: PayrollStatus | null;
    payrollRevision: number | null;
    staff: readonly CompanyReportStaffRowDto[];
    totals: CompanyReportTotalsDto;
  }>[];
  totals: CompanyReportTotalsDto;
  charts: Readonly<{
    revenueByBranch: readonly Readonly<{ id: string; label: string; value: string }>[];
    revenueByEmployee: readonly Readonly<{ id: string; label: string; value: string }>[];
    revenueTrend: readonly Readonly<{ businessDate: string; value: string }>[];
    bonusPenalty: readonly Readonly<{
      label: string;
      bonus: string;
      penalty: string;
    }>[];
  }>;
}>;

export type CompanyDashboardDto = Readonly<{
  month: string;
  totals: Readonly<{
    revenueAmount: string;
    workUnits: string;
    penalties: string;
    payrollTotal: string;
    missingAttendance: number;
    unreviewedPayroll: number;
  }>;
  branches: readonly Readonly<{
    id: string;
    code: string;
    name: string;
    revenueAmount: string;
    workUnits: string;
    penalties: string;
    payrollTotal: string;
    missingAttendance: number;
    payrollStatus: PayrollStatus | null;
  }>[];
  upcomingRules: readonly Readonly<{
    id: string;
    type:
      | "PENALTY"
      | "DAILY_REWARD_TIERS"
      | "MONTHLY_LEVEL_RULES"
      | "SALARY_RULES"
      | "KPI_TEMPLATE";
    ruleSetName: string;
    versionNo: number;
    effectiveFrom: string;
  }>[];
}>;

export type ManagerKpiCriterionLineDto = Readonly<{
  id: string;
  code: string;
  name: string;
  description: string;
  weightBps: number;
  maxScore: number;
  requiredEvidence: boolean;
  requiredNote: boolean;
  displayOrder: number;
  score: string;
  weightedScore: string;
  note: string | null;
  evidence: string | null;
}>;

export type ManagerKpiEvaluationDto = Readonly<{
  id: string;
  month: string;
  status: "DRAFT" | "PUBLISHED";
  version: number;
  totalScore: string;
  maximumScore: string;
  notes: string | null;
  manager: Readonly<{ id: string; staffCode: string; fullName: string }>;
  branch: Readonly<{ id: string; code: string; name: string }>;
  template: Readonly<{ id: string; ruleSetName: string; versionNo: number }>;
  attendance: Readonly<{
    workUnits: string;
    presentDays: number;
    absentDays: number;
    leaveDays: number;
  }>;
  criteria: readonly ManagerKpiCriterionLineDto[];
  publishedAt: string | null;
}>;

export type ManagerKpiCandidateDto = Readonly<{
  id: string;
  staffCode: string;
  fullName: string;
  branch: Readonly<{ id: string; code: string; name: string }>;
}>;

export type ManagerKpiSettingDto = Readonly<{
  enabled: boolean;
  version: number;
}>;

export const importTemplateSchema = z.enum([
  "BRANCHES",
  "STAFF",
  "ASSIGNMENTS",
  "LEVELS",
  "ATTENDANCE_LIVE",
  "REWARD_RULES",
  "PENALTY_RULES",
  "HISTORICAL_PAYROLL",
]);

export const importPresignSchema = z
  .object({
    template: importTemplateSchema,
    idempotencyKey: z.string().trim().min(8).max(128),
    originalFileName: trimmedText("Tên file", 255).refine(
      (value) => /\.(xlsx|csv)$/i.test(value),
      "Chỉ hỗ trợ file XLSX hoặc CSV.",
    ),
    mimeType: z.enum([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "application/csv",
    ]),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(20 * 1_024 * 1_024),
    checksumSha256: z
      .string()
      .regex(/^[A-Za-z0-9+/]{43}=$/, "Checksum SHA-256 phải là base64 hợp lệ."),
    branchId: idSchema.nullable().optional(),
    reason: reasonSchema,
  })
  .superRefine((value, context) => {
    const isCsvName = /\.csv$/i.test(value.originalFileName);
    const isCsvMime = value.mimeType === "text/csv" || value.mimeType === "application/csv";
    if (isCsvName !== isCsvMime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mimeType"],
        message: "Loại nội dung không khớp với phần mở rộng của file.",
      });
    }
  });

export const importPreviewSchema = z.object({
  mapping: z.record(z.string().min(1).max(80), z.string().min(1).max(200)),
  dryRun: z.boolean().default(true),
});

export const importCommitSchema = z.object({
  confirm: z.literal(true),
  reason: reasonSchema,
});

export const importListQuerySchema = z.object({
  template: importTemplateSchema.optional(),
  status: z
    .enum([
      "PENDING_UPLOAD",
      "UPLOADED",
      "VALIDATING",
      "VALIDATED",
      "COMMITTING",
      "SUCCEEDED",
      "FAILED",
    ])
    .optional(),
  branchId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const dataExportTemplateSchema = z.enum([
  "EMPLOYEE_ERROR_REPORT",
  "BRANCH_MONTHLY",
  "PAYSLIP",
  "COMPANY_MONTHLY",
  "AUDIT",
]);

export const dataExportCreateSchema = z.object({
  template: dataExportTemplateSchema,
  format: z.enum(["XLSX", "CSV"]),
  branchId: idSchema.nullable().optional(),
  month: businessMonthSchema.optional(),
  staffId: idSchema.nullable().optional(),
  payrollPeriodId: idSchema.nullable().optional(),
  auditFilters: z
    .object({
      actorUserId: idSchema.optional(),
      branchId: idSchema.optional(),
      entityType: z.string().trim().max(120).optional(),
      entityId: z.string().trim().max(160).optional(),
      action: z.string().trim().max(120).optional(),
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional(),
    })
    .refine(({ from, to }) => !from || !to || from < to, {
      message: "Mốc bắt đầu phải trước mốc kết thúc.",
      path: ["to"],
    })
    .optional(),
  reason: reasonSchema,
});

export const dataExportListQuerySchema = z.object({
  status: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "EXPIRED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const auditListQuerySchema = z
  .object({
    actorUserId: idSchema.optional(),
    entityType: z.string().trim().max(120).optional(),
    entityId: z.string().trim().max(160).optional(),
    branchId: idSchema.optional(),
    action: z.string().trim().max(120).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: idSchema.optional(),
  })
  .refine(({ from, to }) => !from || !to || from < to, {
    message: "Mốc bắt đầu phải trước mốc kết thúc.",
    path: ["to"],
  });

export type ImportErrorDto = Readonly<{
  id: string;
  sheetName: string;
  rowNumber: number;
  columnName: string;
  code: string;
  message: string;
  severity: "WARNING" | "ERROR" | "CRITICAL";
  rawValue: string | null;
}>;

export type ImportJobDto = Readonly<{
  id: string;
  template:
    | "BRANCHES"
    | "STAFF"
    | "ASSIGNMENTS"
    | "LEVELS"
    | "ATTENDANCE_LIVE"
    | "REWARD_RULES"
    | "PENALTY_RULES"
    | "HISTORICAL_PAYROLL";
  status:
    | "PENDING_UPLOAD"
    | "UPLOADED"
    | "VALIDATING"
    | "VALIDATED"
    | "COMMITTING"
    | "SUCCEEDED"
    | "FAILED";
  branchId: string | null;
  originalFileName: string;
  sizeBytes: string;
  checksumSha256: string;
  sourceHeaders: readonly string[];
  mapping: Readonly<Record<string, string>>;
  previewRows: readonly Readonly<Record<string, string | number | boolean | null>>[];
  totalRows: number;
  validRows: number;
  errorRows: number;
  committedRows: number;
  dryRun: boolean;
  errorMessage: string | null;
  createdAt: string;
  uploadedAt: string | null;
  validatedAt: string | null;
  committedAt: string | null;
  errors: readonly ImportErrorDto[];
}>;

export type ImportTemplateDefinitionDto = Readonly<{
  template: ImportJobDto["template"];
  label: string;
  fields: readonly Readonly<{
    key: string;
    label: string;
    required: boolean;
  }>[];
}>;

export type DataExportJobDto = Readonly<{
  id: string;
  template: "EMPLOYEE_ERROR_REPORT" | "BRANCH_MONTHLY" | "PAYSLIP" | "COMPANY_MONTHLY" | "AUDIT";
  format: "XLSX" | "CSV";
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "EXPIRED";
  branchId: string | null;
  progress: number;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string;
}>;

export type AuditLogDto = Readonly<{
  id: string;
  branchId: string | null;
  actor: Readonly<{ id: string; name: string; email: string }> | null;
  action: string;
  entityType: string;
  entityId: string;
  reason: string;
  before: unknown;
  after: unknown;
  changes: readonly Readonly<{ path: string; before: unknown; after: unknown }>[];
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  occurredAt: string;
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
export type CompanyReportQuery = z.infer<typeof companyReportQuerySchema>;
export type CompanyReportExportQuery = z.infer<typeof companyReportExportQuerySchema>;
export type CompanyDashboardQuery = z.infer<typeof companyDashboardQuerySchema>;
export type ManagerKpiListQuery = z.infer<typeof managerKpiListQuerySchema>;
export type ManagerKpiCreateInput = z.infer<typeof managerKpiCreateSchema>;
export type ManagerKpiUpdateInput = z.infer<typeof managerKpiUpdateSchema>;
export type ManagerKpiPublishInput = z.infer<typeof managerKpiPublishSchema>;
export type ManagerKpiSettingUpdateInput = z.infer<typeof managerKpiSettingUpdateSchema>;
export type PenaltyRuleSetCreateInput = z.infer<typeof penaltyRuleSetCreateSchema>;
export type PenaltyRuleDraftCreateInput = z.infer<typeof penaltyRuleDraftCreateSchema>;
export type PenaltyRuleDraftUpdateInput = z.infer<typeof penaltyRuleDraftUpdateSchema>;
export type PenaltyRulePublishInput = z.infer<typeof penaltyRulePublishSchema>;
export type PenaltyRuleRetireInput = z.infer<typeof penaltyRuleRetireSchema>;
export type ConfiguredRuleSetCreateInput = z.infer<typeof configuredRuleSetCreateSchema>;
export type ConfiguredRuleDraftCreateInput = z.infer<typeof configuredRuleDraftCreateSchema>;
export type ConfiguredRuleDraftUpdateInput = z.infer<typeof configuredRuleDraftUpdateSchema>;
export type RuleImpactPreviewInput = z.infer<typeof ruleImpactPreviewSchema>;
export type LevelProposalGenerateInput = z.infer<typeof levelProposalGenerateSchema>;
export type LevelProposalConfirmInput = z.infer<typeof levelProposalConfirmSchema>;
export type ViolationCreateInput = z.infer<typeof violationCreateSchema>;
export type ViolationCancelInput = z.infer<typeof violationCancelSchema>;
export type EvidencePresignInput = z.infer<typeof evidencePresignSchema>;
export type EvidenceCompleteInput = z.infer<typeof evidenceCompleteSchema>;
export type PayrollPeriodListQuery = z.infer<typeof payrollPeriodListQuerySchema>;
export type PayrollPeriodCreateInput = z.infer<typeof payrollPeriodCreateSchema>;
export type PayrollPeriodActionInput = z.infer<typeof payrollPeriodActionSchema>;
export type PayrollRevisionCreateInput = z.infer<typeof payrollRevisionCreateSchema>;
export type PayrollAdjustmentCreateInput = z.infer<typeof payrollAdjustmentCreateSchema>;
export type PayrollExportCreateInput = z.infer<typeof payrollExportCreateSchema>;
export type ImportTemplate = z.infer<typeof importTemplateSchema>;
export type ImportPresignInput = z.infer<typeof importPresignSchema>;
export type ImportPreviewInput = z.infer<typeof importPreviewSchema>;
export type ImportCommitInput = z.infer<typeof importCommitSchema>;
export type ImportListQuery = z.infer<typeof importListQuerySchema>;
export type DataExportCreateInput = z.infer<typeof dataExportCreateSchema>;
export type DataExportListQuery = z.infer<typeof dataExportListQuerySchema>;
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
