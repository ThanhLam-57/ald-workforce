import type { NextConfig } from "next";
import path from "node:path";

const developmentEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  outputFileTracingIncludes: {
    "/api/exports/company-report": ["assets/fonts/*"],
  },
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["@prisma/adapter-pg", "pdfkit", "pg"],
  transpilePackages: ["@ald/contracts", "@ald/db", "@ald/domain", "@ald/ui"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'${developmentEval}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; upgrade-insecure-requests`,
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
