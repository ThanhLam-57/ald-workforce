function optionalValue(environment: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = environment[key]?.trim();
  if (!value || value.includes("<") || value.includes(">")) {
    return undefined;
  }
  return value;
}

function encodeConnectionPart(value: string): string {
  return encodeURIComponent(value);
}

function isRailwayRuntime(environment: NodeJS.ProcessEnv): boolean {
  return Boolean(
    environment.RAILWAY_PROJECT_ID ||
      environment.RAILWAY_ENVIRONMENT_ID ||
      environment.RAILWAY_SERVICE_ID,
  );
}

function isLocalDatabaseUrl(value: string): boolean {
  return value.includes("127.0.0.1") || value.includes("localhost");
}

export function resolveDatabaseUrl(
  explicit?: string,
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const direct = [
    explicit?.trim(),
    optionalValue(environment, "DATABASE_URL"),
    optionalValue(environment, "DATABASE_PRIVATE_URL"),
    optionalValue(environment, "POSTGRES_URL"),
    optionalValue(environment, "POSTGRES_PRIVATE_URL"),
  ].find(Boolean);
  if (direct && !(isRailwayRuntime(environment) && isLocalDatabaseUrl(direct))) {
    return direct;
  }

  const host = optionalValue(environment, "PGHOST") ?? optionalValue(environment, "POSTGRES_HOST");
  const port = optionalValue(environment, "PGPORT") ?? optionalValue(environment, "POSTGRES_PORT");
  const user = optionalValue(environment, "PGUSER") ?? optionalValue(environment, "POSTGRES_USER");
  const password =
    optionalValue(environment, "PGPASSWORD") ?? optionalValue(environment, "POSTGRES_PASSWORD");
  const database =
    optionalValue(environment, "PGDATABASE") ?? optionalValue(environment, "POSTGRES_DB");

  if (!host || !port || !user || !password || !database) {
    return undefined;
  }

  return `postgresql://${encodeConnectionPart(user)}:${encodeConnectionPart(password)}@${host}:${port}/${encodeConnectionPart(database)}`;
}

export function requiredDatabaseUrl(
  explicit?: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const url = resolveDatabaseUrl(explicit, environment);
  if (url) {
    return url;
  }
  if (environment.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL is required in production. Add a Railway PostgreSQL service and expose its DATABASE_URL or PG* variables to this service.",
    );
  }
  return "postgresql://ald:ald_local_password@127.0.0.1:55432/ald_workforce";
}
