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

export type BranchCreateInput = z.infer<typeof branchCreateSchema>;
export type BranchUpdateInput = z.infer<typeof branchUpdateSchema>;
export type StaffCreateInput = z.infer<typeof staffCreateSchema>;
export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>;
export type AssignmentCreateInput = z.infer<typeof assignmentCreateSchema>;
export type AssignmentUpdateInput = z.infer<typeof assignmentUpdateSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
