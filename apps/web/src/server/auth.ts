import { prisma } from "@ald/db";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin as adminPlugin, username } from "better-auth/plugins";

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
    },
  },
  session: {
    expiresIn: 60 * 60 * 12,
    updateAge: 60 * 60,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
  },
  trustedOrigins: [appUrl],
  disabledPaths: [
    "/sign-up/email",
    "/is-username-available",
    "/admin/remove-user",
    "/update-user",
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
    nextCookies(),
  ],
});
