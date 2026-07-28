import { resolveAppUrl, resolveTrustedOrigins } from "./app-url";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function trustedOrigins(): Set<string> {
  return new Set(resolveTrustedOrigins(resolveAppUrl()));
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
