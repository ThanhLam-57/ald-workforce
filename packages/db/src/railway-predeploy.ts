import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { bootstrapAdmin } from "./bootstrap-admin.js";
import { prisma } from "./client.js";

const prismaCliPath = fileURLToPath(
  new URL("../node_modules/prisma/build/index.js", import.meta.url),
);
const prismaConfigPath = fileURLToPath(new URL("../prisma.config.ts", import.meta.url));

function runCommand(label: string, command: string, args: readonly string[]): Promise<void> {
  console.log(`Railway predeploy: ${label}...`);

  const child = spawn(command, [...args], {
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${label} failed with ${code === null ? `signal ${signal ?? "unknown"}` : `exit code ${code}`}.`,
        ),
      );
    });
  });
}

export async function railwayPredeploy(): Promise<void> {
  await runCommand("Prisma migrate deploy", process.execPath, [
    prismaCliPath,
    "migrate",
    "deploy",
    "--config",
    prismaConfigPath,
  ]);
  await bootstrapAdmin();
}

function isDirectRun(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && pathToFileURL(entrypoint).href === import.meta.url);
}

if (isDirectRun()) {
  railwayPredeploy()
    .catch((error: unknown) => {
      console.error("Railway predeploy failed.", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
