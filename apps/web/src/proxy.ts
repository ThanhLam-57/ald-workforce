import { NextResponse, type NextRequest } from "next/server";

import { isTrustedMutationRequest } from "@/server/request-security";

export function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  if (request.nextUrl.pathname.startsWith("/api/") && !isTrustedMutationRequest(request)) {
    return NextResponse.json(
      {
        error: {
          code: "CSRF_REJECTED",
          message: "Nguồn yêu cầu không được phép.",
        },
      },
      {
        status: 403,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "x-request-id": requestId,
        },
      },
    );
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
