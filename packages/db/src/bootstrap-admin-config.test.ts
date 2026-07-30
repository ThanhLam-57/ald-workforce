import { describe, expect, it } from "vitest";

import {
  readBootstrapAdminConfig,
  shouldWriteBootstrapPassword,
} from "./bootstrap-admin-config.js";

describe("readBootstrapAdminConfig", () => {
  it("does nothing unless explicitly enabled", () => {
    expect(readBootstrapAdminConfig({})).toEqual({ enabled: false });
  });

  it("does not auto-enable on Railway", () => {
    expect(
      readBootstrapAdminConfig({
        RAILWAY_PUBLIC_DOMAIN: "ald-workforce-production.up.railway.app",
      }),
    ).toEqual({ enabled: false });
  });

  it("honors BOOTSTRAP_ADMIN_ENABLED=false on Railway", () => {
    expect(
      readBootstrapAdminConfig({
        RAILWAY_PUBLIC_DOMAIN: "ald-workforce-production.up.railway.app",
        BOOTSTRAP_ADMIN_ENABLED: "false",
      }),
    ).toEqual({ enabled: false });
  });

  it("lets the disabled flag override an explicit enable", () => {
    expect(
      readBootstrapAdminConfig({
        RAILWAY_PUBLIC_DOMAIN: "ald-workforce-production.up.railway.app",
        BOOTSTRAP_ADMIN_ENABLED: "true",
        BOOTSTRAP_ADMIN_DISABLED: "TRUE",
        BOOTSTRAP_ADMIN_PASSWORD: "Temporary-Password-123!",
      }),
    ).toEqual({ enabled: false });
  });

  it("can reset the bootstrap admin password with an explicit recovery flag", () => {
    expect(
      readBootstrapAdminConfig({
        RAILWAY_PUBLIC_DOMAIN: "ald-workforce-production.up.railway.app",
        BOOTSTRAP_ADMIN_ENABLED: "true",
        BOOTSTRAP_ADMIN_PASSWORD: "Recovery-Password-123!",
        BOOTSTRAP_ADMIN_RESET_PASSWORD: "true",
      }),
    ).toMatchObject({
      enabled: true,
      adminPassword: "Recovery-Password-123!",
      resetPassword: true,
    });
  });

  it("does not reset the bootstrap admin password unless the recovery flag is enabled", () => {
    expect(
      readBootstrapAdminConfig({
        RAILWAY_PUBLIC_DOMAIN: "ald-workforce-production.up.railway.app",
        BOOTSTRAP_ADMIN_ENABLED: "true",
        BOOTSTRAP_ADMIN_PASSWORD: "My-New-Admin-Password-123!",
      }),
    ).toMatchObject({
      enabled: true,
      adminPassword: "My-New-Admin-Password-123!",
      resetPassword: false,
    });
  });

  it("requires a strong bootstrap password", () => {
    expect(() =>
      readBootstrapAdminConfig({
        BOOTSTRAP_ADMIN_ENABLED: "true",
        BOOTSTRAP_ADMIN_PASSWORD: "short",
      }),
    ).toThrow("at least 12 characters");
  });

  it("requires an explicit password when bootstrap is enabled", () => {
    expect(() =>
      readBootstrapAdminConfig({
        RAILWAY_PUBLIC_DOMAIN: "ald-workforce-production.up.railway.app",
        BOOTSTRAP_ADMIN_ENABLED: "true",
      }),
    ).toThrow("BOOTSTRAP_ADMIN_PASSWORD is required");
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

describe("shouldWriteBootstrapPassword", () => {
  it("preserves an existing nonempty credential unless reset is explicit", () => {
    expect(shouldWriteBootstrapPassword("existing-password-hash", false)).toBe(false);
  });

  it("replaces an existing credential for an explicit recovery reset", () => {
    expect(shouldWriteBootstrapPassword("existing-password-hash", true)).toBe(true);
  });

  it("repairs a missing or empty credential without requiring reset", () => {
    expect(shouldWriteBootstrapPassword(null, false)).toBe(true);
    expect(shouldWriteBootstrapPassword("", false)).toBe(true);
  });
});
