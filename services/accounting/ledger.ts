import { and, eq, inArray } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { accounts, companySettings, journalEntries, journalLines } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { D, Decimal } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";

export type Line = { account: string; debit?: Decimal.Value; credit?: Decimal.Value; description?: string | null; customerId?: string | null; supplierId?: string | null; containerId?: string | null };
export type EntryInput = {
  date: string; memo: string; sourceType: string; sourceId?: string | null; reversalOf?: string | null; userId?: string | null; lines: Line[];
};

/** Account codes used by the automatic postings. Charts can be extended, but these must exist. */
export const A = {
  CASH: "1000", BANK: "1010", AR: "1200", INVENTORY: "1300", VAT_IN: "1400", AP: "2100", VAT_OUT: "2300", SAL_PAYABLE: "2400", DED_PAYABLE: "2410",
  SALES_LOCAL: "4000", SALES_EXPORT: "4010", COGS: "5000", SALARIES: "6000", OTHER_DIRECT: "5190",
} as const;

export const COST_ACCOUNT: Record<string, string> = {
  freight: "5100", customs_duty: "5110", insurance: "5120", port_charges: "5130", thc: "5130", delivery_order: "5140", clearing: "5140", transport: "5150", labour: "5160", other: "5190",
};

/**
 * Appends a balanced entry to the ledger inside the caller's transaction.
 * Idempotent per (sourceType, sourceId): posting the same source twice returns the existing entry.
 */
export async function post(tx: Tx | typeof db, e: EntryInput) {
  const lines = e.lines.map((l) => ({ ...l, debit: D(l.debit).toDecimalPlaces(2), credit: D(l.credit).toDecimalPlaces(2) })).filter((l) => !l.debit.isZero() || !l.credit.isZero());
  if (!lines.length) return null;
  const dr = lines.reduce((s, l) => s.plus(l.debit), D(0)), cr = lines.reduce((s, l) => s.plus(l.credit), D(0));
  if (!dr.eq(cr)) throw new AppError(500, `Unbalanced journal (${e.sourceType}): debits ${dr.toFixed(2)} vs credits ${cr.toFixed(2)}`);

  if (e.sourceId) {
    const [existing] = await tx.select({ id: journalEntries.id, number: journalEntries.number }).from(journalEntries).where(and(eq(journalEntries.sourceType, e.sourceType), eq(journalEntries.sourceId, e.sourceId)));
    if (existing) return { ...existing, created: false };
  }
  const [co] = await tx.select({ locked: companySettings.booksLockedThrough }).from(companySettings).where(eq(companySettings.id, 1));
  if (co?.locked && e.date <= co.locked) throw new AppError(409, `The books are closed through ${co.locked}: cannot post an entry dated ${e.date}`);

  const codes = [...new Set(lines.map((l) => l.account))];
  const accs = await tx.select({ id: accounts.id, code: accounts.code, active: accounts.isActive }).from(accounts).where(inArray(accounts.code, codes));
  const byCode = new Map(accs.map((a) => [a.code, a]));
  for (const c of codes) if (!byCode.get(c)?.active) throw new AppError(422, `Account ${c} is missing or inactive`);

  const year = e.date.slice(0, 4);
  const number = await nextNumber(tx as Tx, `journal_${year}`, `JV-${year}-`);
  const [entry] = await tx.insert(journalEntries).values({ number, entryDate: e.date, memo: e.memo, sourceType: e.sourceType, sourceId: e.sourceId ?? null, reversalOf: e.reversalOf ?? null, createdBy: e.userId ?? null }).returning();
  await tx.insert(journalLines).values(lines.map((l) => ({
    entryId: entry.id, accountId: byCode.get(l.account)!.id, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2), description: l.description ?? null,
    customerId: l.customerId ?? null, supplierId: l.supplierId ?? null, containerId: l.containerId ?? null,
  })));
  return { id: entry.id, number: entry.number, created: true };
}

/** Mirrors an existing entry (debits <-> credits). */
export async function reverseEntry(tx: Tx, original: { id: string; entryDate: string; memo: string }, sourceType: string, sourceId: string, date: string, userId: string | null, reason?: string) {
  const lines = await tx.select({ code: accounts.code, debit: journalLines.debit, credit: journalLines.credit, description: journalLines.description, customerId: journalLines.customerId, supplierId: journalLines.supplierId, containerId: journalLines.containerId })
    .from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId)).where(eq(journalLines.entryId, original.id));
  return post(tx, {
    date, memo: `Reversal: ${original.memo}${reason ? ` (${reason})` : ""}`, sourceType, sourceId, reversalOf: original.id, userId,
    lines: lines.map((l) => ({ account: l.code, debit: l.credit, credit: l.debit, description: l.description, customerId: l.customerId, supplierId: l.supplierId, containerId: l.containerId })),
  });
}

export async function findEntry(tx: Tx | typeof db, sourceType: string, sourceId: string) {
  const [e] = await tx.select().from(journalEntries).where(and(eq(journalEntries.sourceType, sourceType), eq(journalEntries.sourceId, sourceId)));
  return e ?? null;
}

export const listAccounts = () => db.select().from(accounts).orderBy(accounts.code);
