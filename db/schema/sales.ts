import { pgTable, text, boolean, numeric, uuid, integer, date, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, version } from "./_columns";
import { users } from "./auth";

export const customers = pgTable("customers", {
  id: id(),
  name: text().notNull(),
  contactName: text(),
  email: text(),
  phone: text(),
  address: text(),
  /** Customer TRN (15 digits for UAE businesses). */
  trn: text(),
  creditDays: integer().notNull().default(30),
  isActive: boolean().notNull().default(true),
  version: version(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sales = pgTable(
  "sales",
  {
    id: id(),
    ref: text().notNull().unique(), // SAL-0001
    customerId: uuid().notNull().references(() => customers.id),
    saleDate: date({ mode: "string" }).notNull(),
    /** Free-text reference to the entry / exit bill this sale relates to. */
    billRef: text(),
    notes: text(),
    version: version(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sales_customer_idx").on(t.customerId), index("sales_date_idx").on(t.saleDate)],
);

export const saleLines = pgTable(
  "sale_lines",
  {
    id: id(),
    saleId: uuid().notNull().references(() => sales.id, { onDelete: "cascade" }),
    description: text().notNull(),
    qty: numeric({ precision: 14, scale: 2 }).notNull(),
    unitPrice: numeric({ precision: 14, scale: 2 }).notNull(),
    /** 5 (standard rated) or 0 (zero rated / exempt). */
    vatRate: numeric({ precision: 5, scale: 2 }).notNull().default("5"),
  },
  (t) => [index("sale_lines_sale_idx").on(t.saleId)],
);

export type InvoiceParties = {
  company: { name: string; address: string; trn: string | null; phone: string | null; email: string | null; bankName: string | null; iban: string | null; terms: string | null };
  customer: { name: string; address: string | null; trn: string | null };
};

/** One tax invoice per sale. Issued immediately with a gap-free number and then immutable (DB trigger). */
export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    number: text().notNull().unique(), // INV-2026-0001
    saleId: uuid().notNull().unique().references(() => sales.id),
    customerId: uuid().notNull().references(() => customers.id),
    issueDate: date({ mode: "string" }).notNull(),
    dueDate: date({ mode: "string" }).notNull(),
    subtotal: numeric({ precision: 14, scale: 2 }).notNull(),
    vatTotal: numeric({ precision: 14, scale: 2 }).notNull(),
    total: numeric({ precision: 14, scale: 2 }).notNull(),
    paidAmount: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    parties: jsonb().$type<InvoiceParties>().notNull(),
    notes: text(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("invoices_customer_idx").on(t.customerId), index("invoices_due_idx").on(t.dueDate)],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: id(),
    invoiceId: uuid().notNull().references(() => invoices.id, { onDelete: "restrict" }),
    description: text().notNull(),
    qty: numeric({ precision: 14, scale: 2 }).notNull(),
    unitPrice: numeric({ precision: 14, scale: 2 }).notNull(),
    vatRate: numeric({ precision: 5, scale: 2 }).notNull(),
    net: numeric({ precision: 14, scale: 2 }).notNull(),
    vat: numeric({ precision: 14, scale: 2 }).notNull(),
    total: numeric({ precision: 14, scale: 2 }).notNull(),
  },
  (t) => [index("invoice_lines_invoice_idx").on(t.invoiceId)],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    ref: text().notNull().unique(), // PAY-0001
    invoiceId: uuid().notNull().references(() => invoices.id),
    paymentDate: date({ mode: "string" }).notNull(),
    amount: numeric({ precision: 14, scale: 2 }).notNull(),
    method: text().notNull(), // bank_transfer | cash | cheque | card
    reference: text(),
    createdBy: uuid().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_invoice_idx").on(t.invoiceId)],
);
