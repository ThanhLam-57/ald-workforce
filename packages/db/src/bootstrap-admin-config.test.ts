import { describe, expect, it } from "vitest";

import {
  DEFAULT_BOOTSTRAP_ADMIN_PASSWORD,
  readBootstrapAdminConfig,
} from "./bootstrap-admin-config.js";

describe("readBootstrapAdminConfig", () => {
  it("does nothing unless explicitly enabled", () => {
    expect(readBootstrapAdminConfig({})).toEqual({ enabled: false });
  });

  it("auto-enables on Railway with a first-login default password", () => {
    expect(
      readBootstrapAdminConfig({
        RAILWAY_PUBLIC_DOMAIN: "ald-workforce-production.up.railway.app",
      }),
    ).toMatchObject({
      enabled: true,
      adminUsername: "admin",
      adminPassword: DEFAULT_BOOTSTRAP_ADMIN_PASSWORD,
      resetPassword: false,
    });
  });

  it("allows explicitly disabling Railway bootstrap after the first deploy", () => {
    expect(
      readBootstrapAdminConfig({
        RAILWAY_PUBLIC_DOMAIN: "ald-workforce-production.up.railway.app",
        BOOTSTRAP_ADMIN_DISABLED: "true",
      }),
    ).toEqual({ enabled: false });
  });

  it("ignores imported placeholder passwords on Railway", () => {
    expect(
      readBootstrapAdminConfig({
        RAILWAY_PUBLIC_DOMAIN: "ald-workforce-production.up.railway.app",
        BOOTSTRAP_ADMIN_ENABLED: "false",
        BOOTSTRAP_ADMIN_PASSWORD: "<strong-temporary-password>",
      }),
    ).toMatchObject({
      enabled: true,
      adminPassword: DEFAULT_BOOTSTRAP_ADMIN_PASSWORD,
      resetPassword: false,
    });
  });

  it("can reset the bootstrap admin password with an explicit recovery flag", () => {
    expect(
      readBootstrapAdminConfig({
        RAILWAY_PUBLIC_DOMAIN: "ald-workforce-production.up.railway.app",
        BOOTSTRAP_ADMIN_RESET_PASSWORD: "true",
      }),
    ).toMatchObject({
      enabled: true,
      adminPassword: DEFAULT_BOOTSTRAP_ADMIN_PASSWORD,
      resetPassword: true,
    });
  });

  it("resets the bootstrap admin password when a real password is explicitly configured", () => {
    expect(
      readBootstrapAdminConfig({
        RAILWAY_PUBLIC_DOMAIN: "ald-workforce-production.up.railway.app",
        BOOTSTRAP_ADMIN_PASSWORD: "My-New-Admin-Password-123!",
      }),
    ).toMatchObject({
      enabled: true,
      adminPassword: "My-New-Admin-Password-123!",
      resetPassword: true,
    });
  });

  it("requires a strong temporary password", () => {
    expect(() =>
      readBootstrapAdminConfig({
        BOOTSTRAP_ADMIN_ENABLED: "true",
        BOOTSTRAP_ADMIN_PASSWORD: "short",
      }),
    ).toThrow("at least 12 characters");
  });

  it("normalizes identifiers and applies safe defaults", () => {
    expect(
      readBootstrapAdminConfig({
        BOOTSTRAP_ADMIN_ENABLED: "true",
        BOOTSTRAP_ADMIN_PASSWORD: "Temporary-Password-123!",
        BOOTSTRAP_ADMIN_USERNAME: "Admin",
        BOOTSTRAP_ADMIN_EMAIL: "Admin@ALD.Local",
        BOOTSTRAP_COMPANY_SLUG: "ALD",
        BOOTSTRAP_ADMIN_STAFF_CODE: "gm001",
      }),
    ).toMatchObject({
      enabled: true,
      companyName: "ALD",
      companySlug: "ald",
      revenueUnit: "COIN",
      staffCode: "GM001",
      adminName: "Tổng quản lý",
      adminEmail: "admin@ald.local",
      adminUsername: "admin",
    });
  });
});
