import { pgTable, pgEnum, text, boolean, numeric, uuid, date, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, createdAt } from "./_columns";
import { users } from "./auth";
import { containers, customers, suppliers } from "./containers";

export const accountType = pgEnum("account_type", ["asset", "liability", "equity", "income", "expense"]);

export const accounts = pgTable("accounts", {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  type: accountType().notNull(),
  /** System accounts are used by automatic postings and cannot be deactivated. */
  isSystem: boolean().notNull().default(false),
  /** Cash and bank accounts: the basis of the cash-flow report. */
  isCash: boolean().notNull().default(false),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
});

/** Immutable once written (DB trigger). Corrections are reversing entries. */
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: id(),
    number: text().notNull().unique(), // JV-2026-0001
    entryDate: date({ mode: "string" }).notNull(),
    memo: text().notNull(),
    /** invoice | payment | container_receipt | container_cost | cogs | payroll | payroll_paid | payable_payment | manual | reversal ... */
    sourceType: text().notNull(),
    sourceId: text(),
    reversalOf: uuid(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    // One posting per source document: makes automatic posting idempotent.
    uniqueIndex("journal_source_uq").on(t.sourceType, t.sourceId).where(sql`${t.sourceId} is not null`),
    index("journal_date_idx").on(t.entryDate),
  ],
);

export const journalLines = pgTable(
  "journal_lines",
  {
    id: id(),
    entryId: uuid().notNull().references(() => journalEntries.id),
    accountId: uuid().notNull().references(() => accounts.id),
    debit: numeric({ precision: 16, scale: 2 }).notNull().default("0"),
    credit: numeric({ precision: 16, scale: 2 }).notNull().default("0"),
    description: text(),
    // Analysis dimensions
    customerId: uuid().references(() => customers.id),
    supplierId: uuid().references(() => suppliers.id),
    containerId: uuid().references(() => containers.id),
  },
  (t) => [index("journal_lines_entry_idx").on(t.entryId), index("journal_lines_account_idx").on(t.accountId)],
);

/** Amounts owed to suppliers and others (the sub-ledger behind accounts payable). */
export const payables = pgTable(
  "payables",
  {
    id: id(),
    supplierId: uuid().references(() => suppliers.id),
    payeeName: text().notNull(),
    description: text().notNull(),
    containerId: uuid().references(() => containers.id),
    docDate: date({ mode: "string" }).notNull(),
    dueDate: date({ mode: "string" }).notNull(),
    amountAed: numeric({ precision: 16, scale: 2 }).notNull(),
    paidAed: numeric({ precision: 16, scale: 2 }).notNull().default("0"),
    sourceType: text().notNull(), // container_receipt | container_cost | manual
    sourceId: text(),
    createdAt: createdAt(),
  },
  (t) => [index("payables_supplier_idx").on(t.supplierId), uniqueIndex("payables_source_uq").on(t.sourceType, t.sourceId).where(sql`${t.sourceId} is not null`)],
);

export const payablePayments = pgTable("payable_payments", {
  id: id(),
  ref: text().notNull().unique(), // BPY-0001
  payableId: uuid().notNull().references(() => payables.id),
  paymentDate: date({ mode: "string" }).notNull(),
  amountAed: numeric({ precision: 16, scale: 2 }).notNull(),
  method: text().notNull(),
  reference: text(),
  createdBy: uuid().references(() => users.id),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
