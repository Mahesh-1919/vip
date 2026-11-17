import { sql } from "drizzle-orm";
import { sequences } from "@/db/schema";
import type { Tx } from "@/db";

/**
 * Gap-free sequence (needed for UAE tax invoices). Must be called inside the same transaction
 * that uses the number: the row lock serialises concurrent callers and a rollback releases the number.
 */
export async function nextNumber(tx: Tx, key: string, prefix: string, pad = 4): Promise<string> {
  const [row] = await tx
    .insert(sequences)
    .values({ key, next: 2 })
    .onConflictDoUpdate({ target: sequences.key, set: { next: sql`${sequences.next} + 1` } })
    .returning({ next: sequences.next });
  return `${prefix}${String(row.next - 1).padStart(pad, "0")}`;
}
