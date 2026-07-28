import { describe, expect, it } from "vitest";

import { resolveDatabaseUrl, requiredDatabaseUrl } from "./database-url.js";

describe("resolveDatabaseUrl", () => {
  it("prefers the explicit connection string", () => {
    expect(
      resolveDatabaseUrl("postgresql://explicit/app", {
        DATABASE_URL: "postgresql://env/app",
      } as NodeJS.ProcessEnv),
    ).toBe("postgresql://explicit/app");
  });

  it("uses Railway PostgreSQL PG variables when DATABASE_URL is not present", () => {
    expect(
      resolveDatabaseUrl(undefined, {
        PGHOST: "postgres.railway.internal",
        PGPORT: "5432",
        PGUSER: "railway",
        PGPASSWORD: "pass word",
        PGDATABASE: "railway",
      } as NodeJS.ProcessEnv),
    ).toBe("postgresql://railway:pass%20word@postgres.railway.internal:5432/railway");
  });

  it("ignores imported local placeholder URLs on Railway", () => {
    expect(
      resolveDatabaseUrl(undefined, {
        RAILWAY_SERVICE_ID: "service-id",
        DATABASE_URL: "postgresql://<db-user>:<db-password>@127.0.0.1:55432/<db-name>",
        PGHOST: "postgres.railway.internal",
        PGPORT: "5432",
        PGUSER: "railway",
        PGPASSWORD: "secret",
        PGDATABASE: "railway",
      } as NodeJS.ProcessEnv),
    ).toBe("postgresql://railway:secret@postgres.railway.internal:5432/railway");
  });

  it("keeps local fallback outside production", () => {
    expect(requiredDatabaseUrl(undefined, {} as NodeJS.ProcessEnv)).toContain(
      "127.0.0.1:55432",
    );
  });
});
