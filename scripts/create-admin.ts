// Usage: npm run admin:create -- --email tony@example.com --name "Tony Jose" [--role owner|staff]
// The password is read from ADMIN_PASSWORD or prompted interactively.
// --if-missing leaves an existing admin with that email untouched (used on deploy).
import "dotenv/config";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { createInterface } from "node:readline/promises";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email") ?? process.env.ADMIN_EMAIL;
  const name = arg("name") ?? process.env.ADMIN_NAME ?? "Tony Jose";
  const role = arg("role") ?? "owner";
  if (!email) throw new Error("Provide --email");
  const ifMissing = process.argv.includes("--if-missing");
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question("Password (min 12 characters): ");
    rl.close();
  }
  if (!password || password.length < 12) throw new Error("Password must be at least 12 characters.");
  const hash = await bcrypt.hash(password, 12);
  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined });
  await db.connect();
  const existing = await db.query(`SELECT id FROM admin_users WHERE lower(email) = lower($1)`, [email]);
  if (existing.rowCount && ifMissing) {
    console.log(`Admin ${email} already exists, leaving it unchanged.`);
  } else if (existing.rowCount) {
    await db.query(`UPDATE admin_users SET password_hash = $1, name = $2, role = $3 WHERE id = $4`, [hash, name, role, existing.rows[0].id]);
    await db.query(`DELETE FROM admin_sessions WHERE admin_id = $1`, [existing.rows[0].id]);
    console.log(`Updated admin ${email} (existing sessions signed out).`);
  } else {
    await db.query(`INSERT INTO admin_users (name, email, password_hash, role) VALUES ($1,$2,$3,$4)`, [name, email, hash, role]);
    console.log(`Created admin ${email}.`);
  }
  await db.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
