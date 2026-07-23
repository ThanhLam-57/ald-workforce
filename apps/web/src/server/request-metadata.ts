export type RequestMetadata = Readonly<{
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}>;

export function getRequestMetadata(request: Request): RequestMetadata {
  return {
    requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
    ipAddress:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip"),
    userAgent: request.headers.get("user-agent"),
  };
}
