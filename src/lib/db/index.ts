import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __tjPool?: Pool; __tjDb?: DB };

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
}

export function getPool(): Pool {
  if (!globalForDb.__tjPool) globalForDb.__tjPool = createPool();
  return globalForDb.__tjPool;
}

export function getDb(): DB {
  if (!globalForDb.__tjDb) globalForDb.__tjDb = drizzle(getPool(), { schema });
  return globalForDb.__tjDb;
}

export { schema };

/** Postgres error code raised by the appointments_no_overlap exclusion constraint. */
export const EXCLUSION_VIOLATION = "23P01";
export const UNIQUE_VIOLATION = "23505";

export function pgErrorCode(err: unknown): string | undefined {
  let e: unknown = err;
  // drizzle wraps driver errors in `cause`
  for (let i = 0; i < 3 && e; i++) {
    if (typeof e === "object" && e && "code" in e && typeof (e as { code: unknown }).code === "string") {
      return (e as { code: string }).code;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}
