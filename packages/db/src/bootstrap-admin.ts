import { hashPassword } from "better-auth/crypto";
import { pathToFileURL } from "node:url";

import {
  readBootstrapAdminConfig,
  shouldWriteBootstrapPassword,
} from "./bootstrap-admin-config.js";
import { prisma } from "./client.js";

export async function bootstrapAdmin(): Promise<void> {
  const config = readBootstrapAdminConfig(process.env);
  if (!config.enabled) {
    console.log("Admin bootstrap skipped.");
    return;
  }

  const passwordHash = await hashPassword(config.adminPassword);

  await prisma.$transaction(async (transaction) => {
    const company = await transaction.company.upsert({
      where: { slug: config.companySlug },
      update: { name: config.companyName, revenueUnit: config.revenueUnit },
      create: {
        name: config.companyName,
        slug: config.companySlug,
        revenueUnit: config.revenueUnit,
      },
    });

    const staff = await transaction.staffMember.upsert({
      where: {
        companyId_staffCode: {
          companyId: company.id,
          staffCode: config.staffCode,
        },
      },
      update: {
        fullName: config.adminName,
        email: config.adminEmail,
        jobTitle: "Tổng quản lý",
        employmentCategory: "OFFICIAL",
        employmentStatus: "ACTIVE",
      },
      create: {
        companyId: company.id,
        staffCode: config.staffCode,
        fullName: config.adminName,
        email: config.adminEmail,
        jobTitle: "Tổng quản lý",
        employmentCategory: "OFFICIAL",
      },
    });

    const users = await transaction.user.findMany({
      where: {
        OR: [{ email: config.adminEmail }, { username: config.adminUsername }],
      },
      select: { id: true, companyId: true },
    });
    const uniqueUserIds = new Set(users.map((user) => user.id));
    if (uniqueUserIds.size > 1) {
      throw new Error("Bootstrap email and username belong to different users.");
    }

    const existingUser = users[0];
    if (existingUser && existingUser.companyId !== company.id) {
      throw new Error("Bootstrap administrator belongs to another company.");
    }

    const existingCredential = existingUser
      ? await transaction.account.findFirst({
          where: { userId: existingUser.id, providerId: "credential" },
          select: { id: true, password: true },
        })
      : null;
    const shouldWritePassword = shouldWriteBootstrapPassword(
      existingCredential?.password,
      config.resetPassword,
    );
    const passwordProvisionedAt = shouldWritePassword ? new Date() : undefined;

    const user = existingUser
      ? await transaction.user.update({
          where: { id: existingUser.id },
          data: {
            companyId: company.id,
            staffId: staff.id,
            name: config.adminName,
            email: config.adminEmail,
            emailVerified: true,
            username: config.adminUsername,
            displayUsername: config.adminUsername,
            role: "GENERAL_MANAGER",
            canManagePayroll: true,
            active: true,
            banned: false,
            banReason: null,
            mustChangePassword: false,
            ...(passwordProvisionedAt ? { passwordChangedAt: passwordProvisionedAt } : {}),
          },
        })
      : await transaction.user.create({
          data: {
            companyId: company.id,
            staffId: staff.id,
            name: config.adminName,
            email: config.adminEmail,
            emailVerified: true,
            username: config.adminUsername,
            displayUsername: config.adminUsername,
            role: "GENERAL_MANAGER",
            canManagePayroll: true,
            active: true,
            mustChangePassword: false,
            invitedAt: new Date(),
            passwordChangedAt: passwordProvisionedAt ?? new Date(),
          },
        });

    if (!existingCredential) {
      await transaction.account.create({
        data: {
          accountId: user.id,
          providerId: "credential",
          userId: user.id,
          password: passwordHash,
        },
      });
    } else if (shouldWritePassword) {
      await transaction.account.update({
        where: { id: existingCredential.id },
        data: { password: passwordHash },
      });
    }
    if (config.resetPassword) {
      await transaction.rateLimit.deleteMany();
    }
  });

  console.log(
    `Admin bootstrap completed for username "${config.adminUsername}"${
      config.resetPassword ? " with requested password reset" : ""
    }.`,
  );
}

function isDirectRun(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && pathToFileURL(entrypoint).href === import.meta.url);
}

if (isDirectRun()) {
  bootstrapAdmin()
    .catch((error: unknown) => {
      console.error("Admin bootstrap failed.", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
