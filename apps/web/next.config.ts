import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["@prisma/adapter-pg", "pg"],
  transpilePackages: ["@ald/contracts", "@ald/db", "@ald/domain", "@ald/ui"],
};

export default nextConfig;
