// Runs on every Vercel deploy (via the "vercel-build" script): applies migrations,
// seeds default content and, if ADMIN_EMAIL + ADMIN_PASSWORD are set, creates the
// first admin account. All steps are safe to repeat. Skipped when DATABASE_URL is unset.
import "dotenv/config";
import { execSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.warn("deploy-setup: DATABASE_URL is not set, skipping database setup.");
  process.exit(0);
}

const run = (cmd: string) => execSync(cmd, { stdio: "inherit", env: process.env });
run("tsx scripts/migrate.ts");
run("tsx scripts/seed.ts");
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  run("tsx scripts/create-admin.ts --if-missing");
}
