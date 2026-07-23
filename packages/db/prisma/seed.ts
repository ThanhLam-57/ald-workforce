import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth";
import { hashPassword } from "better-auth/crypto";
import { username } from "better-auth/plugins";

import { prisma } from "../src/client.js";

const companyName = process.env.SEED_COMPANY_NAME ?? "ALD";
const companySlug = process.env.SEED_COMPANY_SLUG ?? "ald";
const gmName = process.env.SEED_GM_NAME ?? "Tổng quản lý";
const gmEmail = (process.env.SEED_GM_EMAIL ?? "admin@ald.local").toLowerCase();
const gmUsername = (process.env.SEED_GM_USERNAME ?? "admin").toLowerCase();
const gmPassword = process.env.SEED_GM_PASSWORD;

if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
  throw new Error(
    "Demo seed bị chặn trong production. Chỉ bật ALLOW_DEMO_SEED cho staging cô lập.",
  );
}

if (!gmPassword || gmPassword.length < 12) {
  throw new Error("SEED_GM_PASSWORD phải có ít nhất 12 ký tự.");
}

const requiredGmPassword = gmPassword;
const managerPassword = process.env.SEED_MANAGER_PASSWORD ?? requiredGmPassword;
const employeePassword = process.env.SEED_EMPLOYEE_PASSWORD ?? requiredGmPassword;

const company = await prisma.company.upsert({
  where: { slug: companySlug },
  update: { name: companyName },
  create: { name: companyName, slug: companySlug },
});

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
      mustChangePassword: {
        type: "boolean",
        required: true,
        defaultValue: false,
        input: false,
      },
      invitedAt: { type: "date", required: false, input: false },
      passwordChangedAt: { type: "date", required: false, input: false },
    },
  },
  plugins: [username()],
});

async function ensurePasswordCredential(userId: string, password: string): Promise<void> {
  const credential = await prisma.account.findFirst({
    where: { userId, providerId: "credential" },
    select: { id: true },
  });
  if (credential) return;
  await prisma.account.create({
    data: {
      accountId: userId,
      providerId: "credential",
      userId,
      password: await hashPassword(password),
    },
  });
}

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
  const created = await seedAuth.api.signUpEmail({
    body: {
      email: gmEmail,
      name: gmName,
      password: requiredGmPassword,
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
    mustChangePassword: false,
    passwordChangedAt: new Date(),
  },
});
await ensurePasswordCredential(seededUserId, requiredGmPassword);

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
const demoManagerUser = await prisma.user.upsert({
  where: { email: "manager.demo@ald.local" },
  update: {
    companyId: company.id,
    staffId: demoManager.id,
    name: demoManager.fullName,
    role: "TRAINING_MANAGER",
    active: true,
    username: "manager_demo",
    displayUsername: "manager_demo",
    mustChangePassword: false,
    passwordChangedAt: new Date(),
  },
  create: {
    companyId: company.id,
    staffId: demoManager.id,
    name: demoManager.fullName,
    email: "manager.demo@ald.local",
    emailVerified: true,
    username: "manager_demo",
    displayUsername: "manager_demo",
    role: "TRAINING_MANAGER",
    active: true,
    mustChangePassword: false,
    passwordChangedAt: new Date(),
  },
});
await ensurePasswordCredential(demoManagerUser.id, managerPassword);

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

async function upsertDemoStaff(input: {
  staffCode: string;
  fullName: string;
  email?: string;
  streamingAlias?: string;
  jobTitle: string;
}) {
  return prisma.staffMember.upsert({
    where: {
      companyId_staffCode: { companyId: company.id, staffCode: input.staffCode },
    },
    update: {
      fullName: input.fullName,
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.streamingAlias !== undefined ? { streamingAlias: input.streamingAlias } : {}),
      jobTitle: input.jobTitle,
      employmentStatus: "ACTIVE",
    },
    create: {
      companyId: company.id,
      staffCode: input.staffCode,
      fullName: input.fullName,
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.streamingAlias !== undefined ? { streamingAlias: input.streamingAlias } : {}),
      jobTitle: input.jobTitle,
      employmentCategory: "OFFICIAL",
    },
  });
}

async function ensureDemoUser(input: {
  staffId: string;
  name: string;
  email: string;
  username: string;
  role: "TRAINING_MANAGER" | "LIVE_EMPLOYEE";
  password: string;
}) {
  let demoUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (!demoUser) {
    const created = await seedAuth.api.signUpEmail({
      body: {
        email: input.email,
        name: input.name,
        password: input.password,
        username: input.username,
        displayUsername: input.username,
        companyId: company.id,
        staffId: input.staffId,
        active: true,
      },
    });
    demoUser = await prisma.user.findUniqueOrThrow({ where: { id: created.user.id } });
  }
  demoUser = await prisma.user.update({
    where: { id: demoUser.id },
    data: {
      companyId: company.id,
      staffId: input.staffId,
      name: input.name,
      username: input.username,
      displayUsername: input.username,
      role: input.role,
      active: true,
      banned: false,
      banReason: null,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
  });
  await ensurePasswordCredential(demoUser.id, input.password);
  return demoUser;
}

async function ensureDemoAssignment(
  branchId: string,
  staffId: string,
  assignmentType: "MEMBER" | "PRIMARY_MANAGER",
) {
  const assignment = await prisma.branchAssignment.findFirst({
    where: {
      companyId: company.id,
      branchId,
      staffId,
      assignmentType,
      archivedAt: null,
    },
    select: { id: true },
  });
  if (!assignment) {
    await prisma.branchAssignment.create({
      data: {
        companyId: company.id,
        branchId,
        staffId,
        assignmentType,
        effectiveFrom: demoMonthStart,
      },
    });
  }
}

async function ensureDemoAttendance(
  branchId: string,
  staffId: string,
  revenueAmount: bigint,
  actualLiveMinutes: number,
) {
  return prisma.attendanceDay.upsert({
    where: {
      companyId_staffId_businessDate: {
        companyId: company.id,
        staffId,
        businessDate: demoWorkDate,
      },
    },
    update: {},
    create: {
      companyId: company.id,
      branchId,
      staffId,
      businessDate: demoWorkDate,
      status: "PRESENT",
      workUnits: "1",
      overtimeMinutes: 30,
      note: "Demo acceptance seed",
      createdByUserId: seededUserId,
      updatedByUserId: seededUserId,
      liveMetric: {
        create: {
          companyId: company.id,
          branchId,
          actualLiveMinutes,
          revenueAmount,
          revenueUnit: "VND",
          revenueScale: 1,
        },
      },
    },
  });
}

const legacySecondBranch = await prisma.branch.findUnique({
  where: { companyId_code: { companyId: company.id, code: "DEMO-B" } },
});
if (legacySecondBranch) {
  await prisma.branch.update({
    where: { id: legacySecondBranch.id },
    data: { code: "BRANCH-B", name: "Cơ sở Demo B", isActive: true },
  });
}
const secondBranch = await prisma.branch.upsert({
  where: { companyId_code: { companyId: company.id, code: "BRANCH-B" } },
  update: { name: "Cơ sở Demo B", isActive: true },
  create: { companyId: company.id, code: "BRANCH-B", name: "Cơ sở Demo B" },
});
const secondManager = await upsertDemoStaff({
  staffCode: "TMDEMO2",
  fullName: "Quản lý đào tạo Demo B",
  email: "manager.b@ald.local",
  jobTitle: "Quản lý đào tạo",
});
const liveA2 = await upsertDemoStaff({
  staffCode: "LIVEA02",
  fullName: "Nhân viên Live A02",
  email: "live.a02@ald.local",
  streamingAlias: "ald-a02",
  jobTitle: "Nhân viên Live",
});
const liveB1 = await upsertDemoStaff({
  staffCode: "LIVEB01",
  fullName: "Nhân viên Live B01",
  email: "live.b01@ald.local",
  streamingAlias: "ald-b01",
  jobTitle: "Nhân viên Live",
});
const liveB2 = await upsertDemoStaff({
  staffCode: "LIVEB02",
  fullName: "Nhân viên Live B02",
  email: "live.b02@ald.local",
  streamingAlias: "ald-b02",
  jobTitle: "Nhân viên Live",
});

const secondManagerUser = await ensureDemoUser({
  staffId: secondManager.id,
  name: secondManager.fullName,
  email: "manager.b@ald.local",
  username: "manager_b",
  role: "TRAINING_MANAGER",
  password: managerPassword,
});
await ensureDemoUser({
  staffId: liveB1.id,
  name: liveB1.fullName,
  email: "live.b01@ald.local",
  username: "live_b01",
  role: "LIVE_EMPLOYEE",
  password: employeePassword,
});

await Promise.all([
  ensureEmploymentHistory(secondManager.id, "ACTIVE", "OFFICIAL"),
  ensureEmploymentHistory(liveA2.id, "ACTIVE", "OFFICIAL"),
  ensureEmploymentHistory(liveB1.id, "ACTIVE", "OFFICIAL"),
  ensureEmploymentHistory(liveB2.id, "ACTIVE", "OFFICIAL"),
  ensureDemoAssignment(demoBranch.id, liveA2.id, "MEMBER"),
  ensureDemoAssignment(secondBranch.id, secondManager.id, "PRIMARY_MANAGER"),
  ensureDemoAssignment(secondBranch.id, liveB1.id, "MEMBER"),
  ensureDemoAssignment(secondBranch.id, liveB2.id, "MEMBER"),
]);

const [attendanceA2, attendanceB1] = await Promise.all([
  ensureDemoAttendance(demoBranch.id, liveA2.id, 1_500_000n, 320),
  ensureDemoAttendance(secondBranch.id, liveB1.id, 1_800_000n, 340),
  ensureDemoAttendance(secondBranch.id, liveB2.id, 1_250_000n, 300),
]);

const penaltySet = await prisma.ruleSet.upsert({
  where: {
    companyId_type_name: {
      companyId: company.id,
      type: "PENALTY",
      name: "Quy định lỗi Demo",
    },
  },
  update: {},
  create: {
    companyId: company.id,
    type: "PENALTY",
    name: "Quy định lỗi Demo",
    createdByUserId: seededUserId,
  },
});
let penaltyVersion = await prisma.ruleVersion.findUnique({
  where: { ruleSetId_versionNo: { ruleSetId: penaltySet.id, versionNo: 1 } },
});
penaltyVersion ??= await prisma.ruleVersion.create({
  data: {
    companyId: company.id,
    ruleSetId: penaltySet.id,
    versionNo: 1,
    status: "DRAFT",
    notes: "Demo acceptance seed",
    createdByUserId: seededUserId,
  },
});
let penaltyItem = await prisma.penaltyItem.findUnique({
  where: {
    ruleVersionId_code: { ruleVersionId: penaltyVersion.id, code: "LATE-DEMO" },
  },
});
penaltyItem ??= await prisma.penaltyItem.create({
  data: {
    companyId: company.id,
    ruleVersionId: penaltyVersion.id,
    code: "LATE-DEMO",
    name: "Đi muộn",
    description: "Check-in sau giờ đã phân công.",
    defaultAmount: 50_000n,
    displayColor: "#F97316",
    displayOrder: 1,
  },
});
if (penaltyVersion.status === "DRAFT") {
  penaltyVersion = await prisma.ruleVersion.update({
    where: { id: penaltyVersion.id },
    data: {
      status: "ACTIVE",
      effectiveFrom: demoMonthStart,
      effectiveTo: demoMonthEnd,
      publishedByUserId: seededUserId,
      publishedAt: new Date(),
    },
  });
}
const existingViolation = await prisma.violation.findFirst({
  where: {
    companyId: company.id,
    attendanceId: attendanceA2.id,
    penaltyItemId: penaltyItem.id,
    status: "ACTIVE",
  },
  select: { id: true },
});
if (!existingViolation) {
  await prisma.violation.create({
    data: {
      companyId: company.id,
      branchId: demoBranch.id,
      attendanceId: attendanceA2.id,
      staffId: liveA2.id,
      businessDate: demoWorkDate,
      penaltyItemId: penaltyItem.id,
      ruleVersionId: penaltyVersion.id,
      itemName: penaltyItem.name,
      amount: penaltyItem.defaultAmount,
      detail: "Demo vi phạm để kiểm thử báo lỗi nhân viên.",
      note: "Không chứa doanh số trong export báo lỗi.",
      createdByUserId: seededUserId,
    },
  });
}
let branchBViolation = await prisma.violation.findFirst({
  where: {
    companyId: company.id,
    attendanceId: attendanceB1.id,
    penaltyItemId: penaltyItem.id,
    status: "ACTIVE",
  },
});
branchBViolation ??= await prisma.violation.create({
  data: {
    companyId: company.id,
    branchId: secondBranch.id,
    attendanceId: attendanceB1.id,
    staffId: liveB1.id,
    businessDate: demoWorkDate,
    penaltyItemId: penaltyItem.id,
    ruleVersionId: penaltyVersion.id,
    itemName: penaltyItem.name,
    amount: penaltyItem.defaultAmount,
    detail: "Fixture bảo mật thuộc riêng cơ sở B.",
    createdByUserId: seededUserId,
  },
});
const branchBEvidence = await prisma.evidenceObject.upsert({
  where: { objectKey: `demo/${company.id}/branch-b-evidence.jpg` },
  update: {},
  create: {
    companyId: company.id,
    branchId: secondBranch.id,
    violationId: branchBViolation.id,
    objectKey: `demo/${company.id}/branch-b-evidence.jpg`,
    originalFileName: "branch-b-private.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 128n,
    checksumSha256: "0".repeat(64),
    status: "READY",
    createdByUserId: seededUserId,
    uploadedAt: new Date(),
    verifiedAt: new Date(),
  },
});

await prisma.payrollPeriod.upsert({
  where: {
    companyId_branchId_month_revision: {
      companyId: company.id,
      branchId: secondBranch.id,
      month: demoMonthStart,
      revision: 1,
    },
  },
  update: {},
  create: {
    companyId: company.id,
    branchId: secondBranch.id,
    month: demoMonthStart,
    revision: 1,
    createdByUserId: seededUserId,
    creationReason: "Demo acceptance seed; mở dashboard để Calculate",
  },
});

console.info(
  JSON.stringify({
    event: "seed.complete",
    companyId: company.id,
    gmUserId: seededUserId,
    gmEmail,
    gmUsername,
    credentials: {
      gm: { username: gmUsername, passwordEnv: "SEED_GM_PASSWORD" },
      managerA: { username: "manager_demo", passwordEnv: "SEED_MANAGER_PASSWORD" },
      managerB: { username: "manager_b", passwordEnv: "SEED_MANAGER_PASSWORD" },
      employee: { username: "live_b01", passwordEnv: "SEED_EMPLOYEE_PASSWORD" },
    },
    payrollDemo: {
      branchId: demoBranch.id,
      staffId: demoStaff.id,
      month: payrollDemoMonth,
    },
    securityDemo: {
      branchAId: demoBranch.id,
      branchBId: secondBranch.id,
      managerAUserId: demoManagerUser.id,
      managerBUserId: secondManagerUser.id,
      branchBAttendanceId: attendanceB1.id,
      branchBEvidenceId: branchBEvidence.id,
    },
  }),
);

await prisma.$disconnect();
