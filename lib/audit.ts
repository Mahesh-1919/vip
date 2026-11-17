import { db, type DB, type Tx } from "@/db";
import { auditLogs } from "@/db/schema";
import { redact } from "./redact";

export type AuditInput = {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  userId?: string | null;
  userEmail?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

/** Pass the surrounding transaction so the audit row commits/rolls back with the change. */
export async function audit(input: AuditInput, tx: DB | Tx = db) {
  await tx.insert(auditLogs).values({
    ...input,
    entityId: input.entityId ?? null,
    before: input.before === undefined ? null : redact(input.before),
    after: input.after === undefined ? null : redact(input.after),
  });
}
