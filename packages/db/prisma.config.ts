import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

dotenv.config({ path: "../../.env", quiet: true });
dotenv.config({ quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://ald:ald_local_password@127.0.0.1:55432/ald_workforce",
  },
});
