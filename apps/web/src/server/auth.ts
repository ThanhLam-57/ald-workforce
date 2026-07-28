import { prisma } from "@ald/db";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin as adminPlugin, twoFactor, username } from "better-auth/plugins";

import {
  authAccessControl,
  generalManagerAuthRole,
  liveEmployeeAuthRole,
  trainingManagerAuthRole,
} from "./auth-permissions";
import { resolveAppUrl, resolveTrustedOrigins } from "./app-url";

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

function optionalSecretValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value || value.includes("<") || value.includes(">")) {
    return undefined;
  }
  return value;
}

function resolveAuthSecret(): string {
  const explicitSecret = optionalSecretValue("BETTER_AUTH_SECRET");
  if (explicitSecret) {
    return explicitSecret;
  }

  const railwaySeed = [
    process.env.RAILWAY_PROJECT_ID,
    process.env.RAILWAY_ENVIRONMENT_ID,
    process.env.RAILWAY_SERVICE_ID,
    process.env.RAILWAY_PUBLIC_DOMAIN,
  ]
    .filter(Boolean)
    .join(":");
  if (railwaySeed) {
    return createHash("sha256").update(`ald-workforce:${railwaySeed}`).digest("hex");
  }

  return requiredProductionValue(
    undefined,
    "BETTER_AUTH_SECRET",
    "local-only-change-me-ald-workforce-32-chars",
  );
}

const appUrl = resolveAppUrl();
const secret = resolveAuthSecret();
const trustedOrigins = resolveTrustedOrigins(appUrl);

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
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for", "x-real-ip", "cf-connecting-ip"],
      trustedProxies: [
        "127.0.0.1/32",
        "::1/128",
        "10.0.0.0/8",
        "100.64.0.0/10",
        "169.254.0.0/16",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "fc00::/7",
        "fe80::/10",
      ],
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
      canManagePayroll: {
        type: "boolean",
        required: true,
        defaultValue: false,
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
