import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";

import { prisma } from "../src/client.js";

const companyName = process.env.SEED_COMPANY_NAME ?? "ALD";
const companySlug = process.env.SEED_COMPANY_SLUG ?? "ald";
const gmName = process.env.SEED_GM_NAME ?? "Tổng quản lý";
const gmEmail = (process.env.SEED_GM_EMAIL ?? "admin@ald.local").toLowerCase();
const gmUsername = (process.env.SEED_GM_USERNAME ?? "admin").toLowerCase();
const gmPassword = process.env.SEED_GM_PASSWORD;

if (!gmPassword || gmPassword.length < 12) {
  throw new Error("SEED_GM_PASSWORD phải có ít nhất 12 ký tự.");
}

const company = await prisma.company.upsert({
  where: { slug: companySlug },
  update: { name: companyName },
  create: { name: companyName, slug: companySlug },
});

const staff = await prisma.staffMember.upsert({
  where: {
    companyId_staffCode: {
      companyId: company.id,
      staffCode: "GM001",
    },
  },
  update: {
    fullName: gmName,
    email: gmEmail,
    jobTitle: "Tổng quản lý",
    employmentCategory: "OFFICIAL",
    employmentStatus: "ACTIVE",
  },
  create: {
    companyId: company.id,
    staffCode: "GM001",
    fullName: gmName,
    email: gmEmail,
    jobTitle: "Tổng quản lý",
    employmentCategory: "OFFICIAL",
  },
});

const existingUser = await prisma.user.findUnique({
  where: { email: gmEmail },
  select: { id: true },
});

let userId = existingUser?.id;
if (!userId) {
  const seedAuth = betterAuth({
    secret: process.env.BETTER_AUTH_SECRET ?? "local-seed-secret-change-me-123456789",
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    advanced: {
      database: {
        generateId: "uuid",
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      autoSignIn: false,
      minPasswordLength: 12,
    },
    user: {
      additionalFields: {
        companyId: { type: "string", required: true, input: true },
        staffId: { type: "string", required: false, input: true },
        active: { type: "boolean", required: true, defaultValue: true, input: true },
        version: { type: "number", required: true, defaultValue: 1, input: false },
      },
    },
    plugins: [username()],
  });

  const created = await seedAuth.api.signUpEmail({
    body: {
      email: gmEmail,
      name: gmName,
      password: gmPassword,
      username: gmUsername,
      displayUsername: gmUsername,
      companyId: company.id,
      staffId: staff.id,
      active: true,
    },
  });
  userId = created.user.id;
}

if (!userId) {
  throw new Error("Không thể xác định GM user sau seed.");
}
const seededUserId = userId;

await prisma.user.update({
  where: { id: seededUserId },
  data: {
    companyId: company.id,
    staffId: staff.id,
    name: gmName,
    username: gmUsername,
    displayUsername: gmUsername,
    role: "GENERAL_MANAGER",
    active: true,
    banned: false,
    banReason: null,
  },
});

const businessMonthParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
}).formatToParts(new Date());
const payrollDemoMonth =
  process.env.SEED_PAYROLL_MONTH ??
  `${businessMonthParts.find((part) => part.type === "year")?.value}-${businessMonthParts.find((part) => part.type === "month")?.value}`;
const [demoYearText, demoMonthText] = payrollDemoMonth.split("-");
const demoYear = Number(demoYearText);
const demoMonthIndex = Number(demoMonthText) - 1;
const demoMonthStart = new Date(Date.UTC(demoYear, demoMonthIndex, 1));
const demoMonthEnd = new Date(Date.UTC(demoYear, demoMonthIndex + 1, 1));
const demoWorkDate = new Date(Date.UTC(demoYear, demoMonthIndex, 15));

const demoBranch = await prisma.branch.upsert({
  where: { companyId_code: { companyId: company.id, code: "DEMO" } },
  update: { name: "Cơ sở Demo Payroll", isActive: true },
  create: {
    companyId: company.id,
    code: "DEMO",
    name: "Cơ sở Demo Payroll",
  },
});
const demoStaff = await prisma.staffMember.upsert({
  where: {
    companyId_staffCode: { companyId: company.id, staffCode: "LIVEDEMO" },
  },
  update: {
    fullName: "Nhân viên Live Demo",
    streamingAlias: "ald-demo",
    employmentStatus: "ACTIVE",
  },
  create: {
    companyId: company.id,
    staffCode: "LIVEDEMO",
    fullName: "Nhân viên Live Demo",
    streamingAlias: "ald-demo",
    jobTitle: "Nhân viên Live",
    employmentCategory: "OFFICIAL",
  },
});
const demoManager = await prisma.staffMember.upsert({
  where: {
    companyId_staffCode: { companyId: company.id, staffCode: "TMDEMO" },
  },
  update: {
    fullName: "Quản lý đào tạo Demo",
    email: "manager.demo@ald.local",
    employmentStatus: "ACTIVE",
  },
  create: {
    companyId: company.id,
    staffCode: "TMDEMO",
    fullName: "Quản lý đào tạo Demo",
    email: "manager.demo@ald.local",
    jobTitle: "Quản lý đào tạo",
    employmentCategory: "OFFICIAL",
  },
});
await prisma.user.upsert({
  where: { email: "manager.demo@ald.local" },
  update: {
    companyId: company.id,
    staffId: demoManager.id,
    name: demoManager.fullName,
    role: "TRAINING_MANAGER",
    active: true,
  },
  create: {
    companyId: company.id,
    staffId: demoManager.id,
    name: demoManager.fullName,
    email: "manager.demo@ald.local",
    emailVerified: true,
    username: "manager-demo",
    displayUsername: "manager-demo",
    role: "TRAINING_MANAGER",
    active: true,
  },
});

async function ensureEmploymentHistory(
  staffId: string,
  employmentStatus: "ACTIVE" | "ON_LEAVE" | "TERMINATED",
  employmentCategory: "OFFICIAL" | "PROBATION" | "CONTRACTOR" | "INTERN",
): Promise<void> {
  const existing = await prisma.staffEmploymentHistory.findFirst({
    where: { companyId: company.id, staffId },
    orderBy: { effectiveFrom: "asc" },
    select: { id: true },
  });
  if (existing) {
    await prisma.staffEmploymentHistory.update({
      where: { id: existing.id },
      data: { employmentStatus, employmentCategory, effectiveTo: null },
    });
  } else {
    await prisma.staffEmploymentHistory.create({
      data: {
        companyId: company.id,
        staffId,
        employmentStatus,
        employmentCategory,
        effectiveFrom: demoMonthStart,
        createdByUserId: seededUserId,
      },
    });
  }
}

await Promise.all([
  ensureEmploymentHistory(staff.id, "ACTIVE", "OFFICIAL"),
  ensureEmploymentHistory(demoStaff.id, "ACTIVE", "OFFICIAL"),
  ensureEmploymentHistory(demoManager.id, "ACTIVE", "OFFICIAL"),
]);

const demoAssignment = await prisma.branchAssignment.findFirst({
  where: {
    companyId: company.id,
    branchId: demoBranch.id,
    staffId: demoStaff.id,
    archivedAt: null,
  },
  select: { id: true },
});
if (!demoAssignment) {
  await prisma.branchAssignment.create({
    data: {
      companyId: company.id,
      branchId: demoBranch.id,
      staffId: demoStaff.id,
      assignmentType: "MEMBER",
      effectiveFrom: demoMonthStart,
    },
  });
}
const demoManagerAssignment = await prisma.branchAssignment.findFirst({
  where: {
    companyId: company.id,
    branchId: demoBranch.id,
    staffId: demoManager.id,
    assignmentType: "PRIMARY_MANAGER",
    archivedAt: null,
  },
  select: { id: true },
});
if (!demoManagerAssignment) {
  await prisma.branchAssignment.create({
    data: {
      companyId: company.id,
      branchId: demoBranch.id,
      staffId: demoManager.id,
      assignmentType: "PRIMARY_MANAGER",
      effectiveFrom: demoMonthStart,
    },
  });
}

async function ensureDemoRule(
  type: "SALARY_RULES" | "DAILY_REWARD_TIERS" | "MONTHLY_LEVEL_RULES" | "KPI_TEMPLATE",
  name: string,
  configuration: object,
): Promise<void> {
  let set = await prisma.ruleSet.findUnique({
    where: { companyId_type_name: { companyId: company.id, type, name } },
    select: { id: true },
  });
  set ??= await prisma.ruleSet.create({
    data: {
      companyId: company.id,
      type,
      name,
      createdByUserId: seededUserId,
    },
    select: { id: true },
  });
  const version = await prisma.ruleVersion.findUnique({
    where: { ruleSetId_versionNo: { ruleSetId: set.id, versionNo: 1 } },
    select: { id: true },
  });
  if (!version) {
    await prisma.ruleVersion.create({
      data: {
        companyId: company.id,
        ruleSetId: set.id,
        versionNo: 1,
        status: "ACTIVE",
        effectiveFrom: demoMonthStart,
        effectiveTo: demoMonthEnd,
        configuration,
        notes: "Sample seed payroll demo",
        createdByUserId: seededUserId,
        publishedByUserId: seededUserId,
        publishedAt: new Date(),
      },
    });
  }
}

await ensureDemoRule("SALARY_RULES", `Demo lương ${payrollDemoMonth}`, {
  kind: "SALARY_RULES",
  baseSalary: "13000000",
  standardWorkdays: "26",
  standardDailyMinutes: 480,
  overtime: { multiplierBps: 15000, eligibleAfterMinutes: 0 },
  attendancePolicy: {
    eligibleStatuses: ["PRESENT"],
    prorateMode: "WORK_UNITS",
    minimumWorkUnitsForFullSalary: null,
    capAtStandardWorkdays: true,
  },
  roundingPolicy: { unit: 1000, mode: "HALF_UP", applyAt: "COMPONENT" },
});
await ensureDemoRule("DAILY_REWARD_TIERS", `Demo thưởng ngày ${payrollDemoMonth}`, {
  kind: "DAILY_REWARD_TIERS",
  gapPolicy: "REQUIRE_CONTIGUOUS",
  tiers: [
    {
      code: "DEMO",
      name: "Demo",
      minRevenue: "0",
      maxRevenue: null,
      minInclusive: true,
      maxInclusive: false,
      rewardAmount: "100000",
      priority: 0,
    },
  ],
});
await ensureDemoRule("MONTHLY_LEVEL_RULES", `Demo thưởng tháng ${payrollDemoMonth}`, {
  kind: "MONTHLY_LEVEL_RULES",
  gapPolicy: "REQUIRE_CONTIGUOUS",
  levels: [
    {
      code: "DEMO",
      name: "Level Demo",
      displayOrder: 1,
      minRevenue: "0",
      maxRevenue: null,
      minInclusive: true,
      maxInclusive: false,
      monthlyRevenueBonus: "300000",
      attendanceBonus: "100000",
      achievementBonus: "100000",
      retainLevelBonus: "0",
      jumpLevelBonus: "0",
      attendanceMinWorkUnits: "1",
      achievementMinLiveMinutes: 300,
      jumpMinLevelSteps: 2,
    },
  ],
});
await ensureDemoRule("KPI_TEMPLATE", `Demo KPI quản lý ${payrollDemoMonth}`, {
  kind: "KPI_TEMPLATE",
  criteria: [
    {
      code: "ATTENDANCE",
      name: "Chấm công và kỷ luật",
      description: "Duy trì hiện diện, đúng giờ và tuân thủ quy trình.",
      weightBps: 4_000,
      maxScore: 100,
      requiredEvidence: false,
      requiredNote: true,
      displayOrder: 1,
    },
    {
      code: "TEAM_RESULT",
      name: "Kết quả đội ngũ",
      description: "Theo dõi và cải thiện hiệu quả nhân viên Live tại cơ sở.",
      weightBps: 6_000,
      maxScore: 100,
      requiredEvidence: true,
      requiredNote: true,
      displayOrder: 2,
    },
  ],
});

const demoAttendance = await prisma.attendanceDay.findUnique({
  where: {
    companyId_staffId_businessDate: {
      companyId: company.id,
      staffId: demoStaff.id,
      businessDate: demoWorkDate,
    },
  },
  select: { id: true },
});
if (!demoAttendance) {
  await prisma.attendanceDay.create({
    data: {
      companyId: company.id,
      branchId: demoBranch.id,
      staffId: demoStaff.id,
      businessDate: demoWorkDate,
      status: "PRESENT",
      workUnits: "1",
      overtimeMinutes: 60,
      note: "Sample seed payroll demo",
      createdByUserId: seededUserId,
      updatedByUserId: seededUserId,
      liveMetric: {
        create: {
          companyId: company.id,
          branchId: demoBranch.id,
          actualLiveMinutes: 360,
          revenueAmount: 2_000_000n,
          revenueUnit: "VND",
          revenueScale: 1,
        },
      },
    },
  });
}
const demoManagerAttendance = await prisma.attendanceDay.findUnique({
  where: {
    companyId_staffId_businessDate: {
      companyId: company.id,
      staffId: demoManager.id,
      businessDate: demoWorkDate,
    },
  },
  select: { id: true },
});
if (!demoManagerAttendance) {
  await prisma.attendanceDay.create({
    data: {
      companyId: company.id,
      branchId: demoBranch.id,
      staffId: demoManager.id,
      businessDate: demoWorkDate,
      status: "PRESENT",
      workUnits: "1",
      note: "Sample seed KPI quản lý",
      createdByUserId: seededUserId,
      updatedByUserId: seededUserId,
    },
  });
}
const demoPeriod = await prisma.payrollPeriod.findFirst({
  where: {
    companyId: company.id,
    branchId: demoBranch.id,
    month: demoMonthStart,
    revision: 1,
  },
  select: { id: true },
});
if (!demoPeriod) {
  await prisma.payrollPeriod.create({
    data: {
      companyId: company.id,
      branchId: demoBranch.id,
      month: demoMonthStart,
      revision: 1,
      createdByUserId: seededUserId,
      creationReason: "Sample seed payroll demo; mở dashboard để Calculate",
    },
  });
}

console.info(
  JSON.stringify({
    event: "seed.complete",
    companyId: company.id,
    gmUserId: seededUserId,
    gmEmail,
    gmUsername,
    payrollDemo: {
      branchId: demoBranch.id,
      staffId: demoStaff.id,
      month: payrollDemoMonth,
    },
  }),
);

await prisma.$disconnect();
