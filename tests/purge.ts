import { gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries, journalLines, payablePayments, payables } from "@/db/schema";

/**
 * Test cleanup only: the ledger is append-only by trigger, so tests that post real entries remove
 * what they created (everything since `since`) with user triggers briefly disabled (dev DB owner only).
 */
export async function purgeSince(since: Date) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`alter table journal_lines disable trigger user`);
    await tx.execute(sql`alter table journal_entries disable trigger user`);
    const ids = (await tx.select({ id: journalEntries.id }).from(journalEntries).where(gte(journalEntries.createdAt, since))).map((e) => e.id);
    if (ids.length) {
      await tx.delete(journalLines).where(sql`${journalLines.entryId} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
      await tx.delete(journalEntries).where(gte(journalEntries.createdAt, since));
    }
    await tx.execute(sql`alter table journal_entries enable trigger user`);
    await tx.execute(sql`alter table journal_lines enable trigger user`);
    await tx.delete(payablePayments).where(gte(payablePayments.createdAt, since));
    await tx.delete(payables).where(gte(payables.createdAt, since));
  });
}
