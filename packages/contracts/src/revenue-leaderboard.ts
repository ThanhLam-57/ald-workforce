import { z } from "zod";

const trimmedText = (max: number) => z.string().trim().min(1).max(max);

export const revenueLeaderboardBranchSchema = z
  .object({
    code: trimmedText(30),
    name: trimmedText(120),
  })
  .strict();

export const revenueLeaderboardItemSchema = z
  .object({
    rank: z.number().int().positive(),
    staffCode: trimmedText(30),
    displayName: trimmedText(120),
    branches: z.array(revenueLeaderboardBranchSchema),
    revenue: z.string().regex(/^\d+$/, "Doanh số phải là số nguyên không âm."),
  })
  .strict();

export const revenueLeaderboardDataSchema = z
  .object({
    month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, "Tháng phải có định dạng YYYY-MM."),
    timezone: z.literal("Asia/Ho_Chi_Minh"),
    unit: z.literal("COIN"),
    generatedAt: z.iso.datetime(),
    totalEmployees: z.number().int().nonnegative(),
    items: z.array(revenueLeaderboardItemSchema),
  })
  .strict();

export const revenueLeaderboardResponseSchema = z
  .object({
    data: revenueLeaderboardDataSchema,
  })
  .strict();

export type RevenueLeaderboardBranchDto = z.infer<typeof revenueLeaderboardBranchSchema>;
export type RevenueLeaderboardItemDto = z.infer<typeof revenueLeaderboardItemSchema>;
export type RevenueLeaderboardDataDto = z.infer<typeof revenueLeaderboardDataSchema>;
export type RevenueLeaderboardResponseDto = z.infer<typeof revenueLeaderboardResponseSchema>;
