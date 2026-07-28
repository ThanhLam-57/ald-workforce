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
    };

function requiredValue(environment: NodeJS.ProcessEnv, key: string, fallback?: string): string {
  const value = environment[key]?.trim() || fallback;
  if (!value) {
    throw new Error(`${key} is required when BOOTSTRAP_ADMIN_ENABLED=true.`);
  }
  return value;
}

export function readBootstrapAdminConfig(environment: NodeJS.ProcessEnv): BootstrapAdminConfig {
  if (environment.BOOTSTRAP_ADMIN_ENABLED !== "true") {
    return { enabled: false };
  }

  const adminPassword = requiredValue(environment, "BOOTSTRAP_ADMIN_PASSWORD");
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
  };
}
