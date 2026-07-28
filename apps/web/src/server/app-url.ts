function optionalValue(environment: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = environment[key]?.trim();
  if (!value || value.includes("<") || value.includes(">")) {
    return undefined;
  }
  return value;
}

function withHttps(hostOrUrl: string): string {
  if (hostOrUrl.startsWith("http://") || hostOrUrl.startsWith("https://")) {
    return hostOrUrl;
  }
  return `https://${hostOrUrl}`;
}

export function resolveAppUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const railwayDomain =
    optionalValue(environment, "RAILWAY_PUBLIC_DOMAIN") ||
    optionalValue(environment, "RAILWAY_STATIC_URL");
  const explicit =
    optionalValue(environment, "BETTER_AUTH_URL") ||
    optionalValue(environment, "NEXT_PUBLIC_APP_URL") ||
    optionalValue(environment, "APP_URL");
  const explicitIsLocal = explicit?.includes("localhost") || explicit?.includes("127.0.0.1");
  if (explicit && !(railwayDomain && explicitIsLocal)) {
    return withHttps(explicit);
  }

  if (railwayDomain) {
    return withHttps(railwayDomain);
  }

  if (environment.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_URL is required when no Railway public domain is available.");
  }
  return "http://localhost:3000";
}

export function resolveTrustedOrigins(
  appUrl = resolveAppUrl(),
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  return Array.from(
    new Set(
      [
        appUrl,
        ...(environment.RAILWAY_PUBLIC_DOMAIN || environment.RAILWAY_STATIC_URL
          ? []
          : [optionalValue(environment, "NEXT_PUBLIC_APP_URL"), optionalValue(environment, "APP_URL")]),
        ...(environment.TRUSTED_ORIGINS ?? "")
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      ]
        .filter((origin): origin is string => Boolean(origin))
        .map((origin) => new URL(withHttps(origin)).origin),
    ),
  );
}
