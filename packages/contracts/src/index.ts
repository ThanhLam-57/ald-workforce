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
}>;

export type AttendanceMonthDto = Readonly<{
  month: string;
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
  violations: readonly [];
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
