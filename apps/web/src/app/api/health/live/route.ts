import { json } from "@/server/http";

export const dynamic = "force-dynamic";

export function GET() {
  return json({
    status: "ok",
    service: "web",
    check: "live",
    timestamp: new Date().toISOString(),
  });
}
