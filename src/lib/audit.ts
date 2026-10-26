import { getDb } from "./db";
import { auditLogs } from "./db/schema";

export async function audit(entry: {
  actor: "admin" | "client" | "system" | "webhook";
  action: string;
  adminId?: string | null;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
}) {
  try {
    await getDb().insert(auditLogs).values({
      actor: entry.actor,
      action: entry.action,
      adminId: entry.adminId ?? null,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      details: entry.details ?? null,
    });
  } catch (err) {
    console.error("[audit] failed to write", err);
  }
}
