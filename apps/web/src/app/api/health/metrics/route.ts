const CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  const configuredToken = process.env.METRICS_TOKEN;
  if (
    process.env.NODE_ENV === "production" &&
    (!configuredToken || request.headers.get("authorization") !== `Bearer ${configuredToken}`)
  ) {
    return new Response("unauthorized\n", {
      status: 401,
      headers: { "Cache-Control": "no-store", "Content-Type": CONTENT_TYPE },
    });
  }

  const memory = process.memoryUsage();
  return new Response(
    [
      "# HELP ald_process_uptime_seconds Process uptime in seconds.",
      "# TYPE ald_process_uptime_seconds gauge",
      `ald_process_uptime_seconds{service="web"} ${process.uptime()}`,
      "# HELP ald_process_resident_memory_bytes Resident memory size in bytes.",
      "# TYPE ald_process_resident_memory_bytes gauge",
      `ald_process_resident_memory_bytes{service="web"} ${memory.rss}`,
      "",
    ].join("\n"),
    {
      headers: { "Cache-Control": "no-store", "Content-Type": CONTENT_TYPE },
    },
  );
}
