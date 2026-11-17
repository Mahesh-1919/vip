"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accounts, companySettings, journalEntries } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { D } from "@/lib/money";
import { clientMeta } from "@/lib/request";
import { post, reverseEntry } from "@/services/accounting/ledger";
import { backfillLedger } from "@/services/accounting/backfill";
import { METHODS, payPayable } from "@/services/accounting/payables";

const dup = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code === "23505";
const done = () => revalidatePath("/accounting", "layout");

export async function addAccount(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("accounting:account:write");
  const p = z.object({ code: z.string().trim().regex(/^\d{4,6}$/, "Code: 4-6 digits"), name: z.string().trim().min(2).max(100), type: z.enum(["asset", "liability", "equity", "income", "expense"]) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  try {
    const [a] = await db.insert(accounts).values({ ...p.data, isCash: form.get("isCash") === "on" }).returning();
    await audit({ action: "create", entity: "account", entityId: a.id, after: a, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
  } catch (e) { if (dup(e)) return { error: "An account with that code exists" }; throw e; }
  done(); return { ok: "Account added" };
}

export async function toggleAccount(form: FormData) {
  const user = await requirePermission("accounting:account:write");
  const p = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) }).parse(Object.fromEntries(form));
  const [a] = await db.select().from(accounts).where(eq(accounts.id, p.id));
  if (!a || a.isSystem) return; // system accounts drive automatic postings
  await db.update(accounts).set({ isActive: p.active === "true" }).where(eq(accounts.id, p.id));
  await audit({ action: p.active === "true" ? "activate" : "deactivate", entity: "account", entityId: p.id, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
  done();
}

/** Manual journal: lines come as acct:<n>, dr:<n>, cr:<n>, memo:<n>. */
export async function manualJournal(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("accounting:journal:write");
  const head = z.object({ date: z.iso.date("Choose the date"), memo: z.string().trim().min(3, "Describe the entry").max(200) }).safeParse(Object.fromEntries(form));
  if (!head.success) return { error: head.error.issues[0].message };
  const lines: { account: string; debit: string; credit: string; description: string | null }[] = [];
  for (let n = 0; n < 8; n++) {
    const account = String(form.get(`acct:${n}`) ?? ""); const dr = String(form.get(`dr:${n}`) ?? "").trim(); const cr = String(form.get(`cr:${n}`) ?? "").trim();
    if (!account && !dr && !cr) continue;
    if (!account) return { error: `Line ${n + 1}: choose an account` };
    for (const v of [dr, cr]) if (v && !/^\d{1,12}(\.\d{1,2})?$/.test(v)) return { error: `Line ${n + 1}: enter a valid amount` };
    if (dr && cr) return { error: `Line ${n + 1}: enter either a debit or a credit, not both` };
    if (!dr && !cr) return { error: `Line ${n + 1}: enter an amount` };
    lines.push({ account, debit: dr || "0", credit: cr || "0", description: String(form.get(`memo:${n}`) ?? "").trim() || null });
  }
  if (lines.length < 2) return { error: "A journal needs at least two lines" };
  const dr = lines.reduce((s, l) => s.plus(l.debit), D(0)), cr = lines.reduce((s, l) => s.plus(l.credit), D(0));
  if (!dr.eq(cr)) return { error: `The entry does not balance: debits ${dr.toFixed(2)} vs credits ${cr.toFixed(2)}` };
  let id = "";
  try {
    id = await db.transaction(async (tx) => {
      const codes = await tx.select({ id: accounts.id, code: accounts.code }).from(accounts);
      const byId = new Map(codes.map((a) => [a.id, a.code]));
      const entry = await post(tx, { date: head.data.date, memo: head.data.memo, sourceType: "manual", sourceId: crypto.randomUUID(), userId: user.id,
        lines: lines.map((l) => ({ account: byId.get(l.account) ?? "", debit: l.debit, credit: l.credit, description: l.description })) });
      await audit({ action: "manual_journal", entity: "journal_entry", entityId: entry!.id, after: { number: entry!.number, memo: head.data.memo, total: dr.toFixed(2) }, userId: user.id, userEmail: user.email, ...(await clientMeta()) }, tx);
      return entry!.id;
    });
  } catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
  done();
  redirect(`/accounting/journal/${id}`);
}

export async function reverseJournal(id: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("accounting:journal:write");
  const reason = z.string().trim().min(3, "Give a reason").max(200).safeParse(form.get("reason"));
  if (!reason.success) return { error: reason.error.issues[0].message };
  try {
    await db.transaction(async (tx) => {
      const [e] = await tx.select().from(journalEntries).where(eq(journalEntries.id, id));
      if (!e) throw new AppError(404, "Entry not found");
      if (e.sourceType !== "manual") throw new AppError(409, "Only manual entries can be reversed here; correct automatic postings through their source document");
      const r = await reverseEntry(tx, e, "reversal", e.id, todayISO(), user.id, reason.data);
      if (r && !r.created) throw new AppError(409, "This entry was already reversed");
      await audit({ action: "reverse_journal", entity: "journal_entry", entityId: id, after: { reason: reason.data }, userId: user.id, userEmail: user.email, ...(await clientMeta()) }, tx);
    });
  } catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
  done(); return { ok: "Entry reversed" };
}

export async function payPayableAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("accounting:payable:write");
  const p = z.object({ payableId: z.uuid(), paymentDate: z.iso.date("Choose the date"), amount: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter a valid amount"), method: z.enum(METHODS), reference: z.string().trim().max(80).transform((v) => v || null) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  try { await payPayable(p.data, user, await clientMeta()); } catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
  done(); return { ok: "Payment recorded" };
}

export async function lockBooks(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("accounting:journal:write");
  await requirePermission("admin:settings:write");
  const d = z.string().trim().transform((v) => v || null).pipe(z.iso.date().nullable()).safeParse(form.get("lockedThrough"));
  if (!d.success) return { error: "Choose a valid date, or leave blank to reopen all periods" };
  await db.update(companySettings).set({ booksLockedThrough: d.data }).where(eq(companySettings.id, 1));
  await audit({ action: "lock_books", entity: "company_settings", entityId: "1", after: { lockedThrough: d.data }, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
  done(); return { ok: d.data ? `Books closed through ${d.data}` : "All periods open" };
}

export async function rebuildPostings(): Promise<ActionState> {
  const user = await requirePermission("accounting:journal:write");
  const c = await backfillLedger(user.id);
  done(); return { ok: `Posted ${Object.values(c).reduce((s, n) => s + n, 0)} missing entries` };
}
