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

await prisma.user.update({
  where: { id: userId },
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

console.info(
  JSON.stringify({
    event: "seed.complete",
    companyId: company.id,
    gmUserId: userId,
    gmEmail,
    gmUsername,
  }),
);

await prisma.$disconnect();
