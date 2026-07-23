import { prisma } from "@ald/db";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin as adminPlugin, twoFactor, username } from "better-auth/plugins";

import {
  authAccessControl,
  generalManagerAuthRole,
  liveEmployeeAuthRole,
  trainingManagerAuthRole,
} from "./auth-permissions";

function requiredProductionValue(
  value: string | undefined,
  name: string,
  localFallback: string,
): string {
  if (value) {
    return value;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${name} là bắt buộc trong production.`);
  }
  return localFallback;
}

const appUrl = requiredProductionValue(
  process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL,
  "BETTER_AUTH_URL",
  "http://localhost:3000",
);
const secret = requiredProductionValue(
  process.env.BETTER_AUTH_SECRET,
  "BETTER_AUTH_SECRET",
  "local-only-change-me-ald-workforce-32-chars",
);
const trustedOrigins = [
  appUrl,
  ...(process.env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
];

export const auth = betterAuth({
  appName: "ALD Workforce",
  baseURL: appUrl,
  secret,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  advanced: {
    database: {
      generateId: "uuid",
    },
    useSecureCookies: process.env.NODE_ENV === "production",
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  user: {
    additionalFields: {
      companyId: {
        type: "string",
        required: true,
        input: true,
      },
      staffId: {
        type: "string",
        required: false,
        input: true,
      },
      active: {
        type: "boolean",
        required: true,
        defaultValue: true,
        input: true,
      },
      version: {
        type: "number",
        required: true,
        defaultValue: 1,
        input: false,
      },
      mustChangePassword: {
        type: "boolean",
        required: true,
        defaultValue: false,
        input: false,
      },
      invitedAt: {
        type: "date",
        required: false,
        input: false,
      },
      passwordChangedAt: {
        type: "date",
        required: false,
        input: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 12,
    updateAge: 60 * 60,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 600, max: 10 },
      "/sign-in/username": { window: 600, max: 10 },
      "/two-factor/verify-totp": { window: 300, max: 8 },
      "/two-factor/verify-backup-code": { window: 300, max: 5 },
      "/change-password": { window: 600, max: 5 },
    },
  },
  trustedOrigins,
  disabledPaths: [
    "/sign-up/email",
    "/is-username-available",
    "/admin/remove-user",
    "/update-user",
    "/change-password",
    "/change-email",
    "/delete-user",
  ],
  telemetry: {
    enabled: false,
  },
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 30,
    }),
    adminPlugin({
      ac: authAccessControl,
      defaultRole: "LIVE_EMPLOYEE",
      roles: {
        GENERAL_MANAGER: generalManagerAuthRole,
        TRAINING_MANAGER: trainingManagerAuthRole,
        LIVE_EMPLOYEE: liveEmployeeAuthRole,
      },
    }),
    twoFactor({
      issuer: "ALD Workforce",
      twoFactorCookieMaxAge: 10 * 60,
      trustDeviceMaxAge: 14 * 24 * 60 * 60,
      accountLockout: {
        enabled: true,
        maxFailedAttempts: 8,
        durationSeconds: 15 * 60,
      },
    }),
    nextCookies(),
  ],
});
