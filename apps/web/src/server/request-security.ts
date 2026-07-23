const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function trustedOrigins(): Set<string> {
  const values = [
    process.env.BETTER_AUTH_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    ...(process.env.TRUSTED_ORIGINS ?? "").split(","),
  ];
  return new Set(
    values
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .map((value) => new URL(value).origin),
  );
}

export function isTrustedMutationRequest(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return trustedOrigins().has(new URL(origin).origin);
  } catch {
    return false;
  }
}
