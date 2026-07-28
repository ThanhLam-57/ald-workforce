export type BootstrapAdminConfig =
  | { enabled: false }
  | {
      enabled: true;
      companyName: string;
      companySlug: string;
      revenueUnit: "COIN" | "VND";
      staffCode: string;
      adminName: string;
      adminEmail: string;
      adminUsername: string;
      adminPassword: string;
      resetPassword: boolean;
    };

export const DEFAULT_BOOTSTRAP_ADMIN_PASSWORD = "ALD-Admin-123456!";

function isRailwayRuntime(environment: NodeJS.ProcessEnv): boolean {
  return Boolean(
    environment.RAILWAY_PROJECT_ID ||
      environment.RAILWAY_ENVIRONMENT_ID ||
      environment.RAILWAY_SERVICE_ID ||
      environment.RAILWAY_PUBLIC_DOMAIN,
  );
}

function requiredValue(environment: NodeJS.ProcessEnv, key: string, fallback?: string): string {
  const candidate = environment[key]?.trim();
  const value =
    candidate && !candidate.includes("<") && !candidate.includes(">") ? candidate : fallback;
  if (!value) {
    throw new Error(`${key} is required when BOOTSTRAP_ADMIN_ENABLED=true.`);
  }
  return value;
}

function optionalValue(environment: NodeJS.ProcessEnv, key: string): string | undefined {
  const candidate = environment[key]?.trim();
  if (!candidate || candidate.includes("<") || candidate.includes(">")) {
    return undefined;
  }
  return candidate;
}

function booleanValue(environment: NodeJS.ProcessEnv, key: string): boolean {
  const value = environment[key]?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "on";
}

export function readBootstrapAdminConfig(environment: NodeJS.ProcessEnv): BootstrapAdminConfig {
  const enabled = environment.BOOTSTRAP_ADMIN_ENABLED?.trim().toLowerCase();
  if (
    environment.BOOTSTRAP_ADMIN_DISABLED === "true" ||
    (enabled === "false" && !isRailwayRuntime(environment)) ||
    (enabled !== "true" && !isRailwayRuntime(environment))
  ) {
    return { enabled: false };
  }

  const explicitAdminPassword = optionalValue(environment, "BOOTSTRAP_ADMIN_PASSWORD");
  const adminPassword =
    explicitAdminPassword ??
    requiredValue(
      environment,
      "BOOTSTRAP_ADMIN_PASSWORD",
      isRailwayRuntime(environment) ? DEFAULT_BOOTSTRAP_ADMIN_PASSWORD : undefined,
    );
  if (adminPassword.length < 12) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD must contain at least 12 characters.");
  }

  const adminEmail = requiredValue(
    environment,
    "BOOTSTRAP_ADMIN_EMAIL",
    "admin@ald.local",
  ).toLowerCase();
  const adminUsername = requiredValue(
    environment,
    "BOOTSTRAP_ADMIN_USERNAME",
    "admin",
  ).toLowerCase();
  const revenueUnit = requiredValue(environment, "BOOTSTRAP_REVENUE_UNIT", "COIN").toUpperCase();
  if (revenueUnit !== "COIN" && revenueUnit !== "VND") {
    throw new Error("BOOTSTRAP_REVENUE_UNIT must be COIN or VND.");
  }

  return {
    enabled: true,
    companyName: requiredValue(environment, "BOOTSTRAP_COMPANY_NAME", "ALD"),
    companySlug: requiredValue(environment, "BOOTSTRAP_COMPANY_SLUG", "ald").toLowerCase(),
    revenueUnit,
    staffCode: requiredValue(environment, "BOOTSTRAP_ADMIN_STAFF_CODE", "GM001").toUpperCase(),
    adminName: requiredValue(environment, "BOOTSTRAP_ADMIN_NAME", "Tổng quản lý"),
    adminEmail,
    adminUsername,
    adminPassword,
    resetPassword: booleanValue(environment, "BOOTSTRAP_ADMIN_RESET_PASSWORD"),
  };
}
