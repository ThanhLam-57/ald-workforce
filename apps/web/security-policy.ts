type SecurityPolicyInput = Readonly<{
  development: boolean;
  storageEndpoint?: string;
}>;

function storageConnectSource(
  endpoint: string | undefined,
  development: boolean,
): string | null {
  if (!endpoint) return null;

  try {
    const url = new URL(endpoint);
    if (url.protocol === "https:") return url.origin;
    if (
      development &&
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    ) {
      return url.origin;
    }
  } catch {
    return null;
  }

  return null;
}

export function buildContentSecurityPolicy({
  development,
  storageEndpoint,
}: SecurityPolicyInput): string {
  const storageSource = storageConnectSource(storageEndpoint, development);
  const connectSources = ["'self'", "https:", ...(storageSource ? [storageSource] : [])];
  const imageSources = ["'self'", "data:", "blob:", "https:", ...(storageSource ? [storageSource] : [])];
  const developmentEval = development ? " 'unsafe-eval'" : "";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'unsafe-inline'${developmentEval}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imageSources.join(" ")}`,
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
