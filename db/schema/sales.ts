import { pgTable, pgEnum, text, numeric, uuid, integer, date, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, version } from "./_columns";
import { users } from "./auth";
import { containerItems, containers, customers } from "./containers";
import { products } from "./inventory";

export const saleStatus = pgEnum("sale_status", ["confirmed", "cancelled"]);
export const invoiceStatus = pgEnum("invoice_status", ["draft", "issued"]);

/** Single-row company profile printed on tax invoices and payslips. */
export const companySettings = pgTable("company_settings", {
  id: integer().primaryKey().default(1),
  name: text().notNull().default("Your Company LLC"),
  address: text().notNull().default("Dubai, United Arab Emirates"),
  /** UAE Tax Registration Number (15 digits). Required to issue tax invoices. */
  trn: text(),
  phone: text(),
  email: text(),
  bankName: text(),
  iban: text(),
  invoiceTerms: text(),
  /** Books are closed up to and including this date: no postings may be dated on or before it. */
  booksLockedThrough: date({ mode: "string" }),
  updatedAt: updatedAt(),
});

export const sales = pgTable(
  "sales",
  {
    id: id(),
    ref: text().notNull().unique(), // SAL-0001
    customerId: uuid().notNull().references(() => customers.id),
    saleDate: date({ mode: "string" }).notNull(),
    /** Main container this sale is linked to (feeds per-container P&L). */
    containerId: uuid().references(() => containers.id),
    currency: text().notNull().default("AED"),
    exchangeRate: numeric({ precision: 14, scale: 6 }).notNull().default("1"),
    status: saleStatus().notNull().default("confirmed"),
    notes: text(),
    version: version(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sales_customer_idx").on(t.customerId), index("sales_container_idx").on(t.containerId), index("sales_date_idx").on(t.saleDate)],
);

export const saleLines = pgTable(
  "sale_lines",
  {
    id: id(),
    saleId: uuid().notNull().references(() => sales.id, { onDelete: "restrict" }),
    productId: uuid().references(() => products.id),
    description: text().notNull(),
    /** Optional link to the exported container item this line sells. */
    containerItemId: uuid().references(() => containerItems.id),
    qty: numeric({ precision: 16, scale: 4 }).notNull(),
    unitPrice: numeric({ precision: 14, scale: 4 }).notNull(),
    /** standard (5%) | zero (exports, intl. transport) | exempt | out_of_scope */
    vatCategory: text().notNull().default("standard"),
    vatRate: numeric({ precision: 5, scale: 2 }).notNull().default("5"),
    createdAt: createdAt(),
  },
  (t) => [index("sale_lines_sale_idx").on(t.saleId), index("sale_lines_item_idx").on(t.containerItemId)],
);

export type InvoiceParties = {
  company: { name: string; address: string; trn: string | null; phone: string | null; email: string | null; bankName: string | null; iban: string | null; terms: string | null };
  customer: { name: string; address: string | null; trn: string | null; country: string | null };
};

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    /** Gap-free tax invoice number, assigned on issue: INV-2026-0001. Null while draft. */
    number: text().unique(),
    status: invoiceStatus().notNull().default("draft"),
    customerId: uuid().notNull().references(() => customers.id),
    saleId: uuid().notNull().references(() => sales.id),
    issueDate: date({ mode: "string" }).notNull(),
    supplyDate: date({ mode: "string" }).notNull(),
    dueDate: date({ mode: "string" }).notNull(),
    currency: text().notNull(),
    exchangeRate: numeric({ precision: 14, scale: 6 }).notNull(),
    subtotal: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    vatTotal: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    total: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    paidAmount: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    /** AED equivalents (VAT in AED is mandatory on UAE tax invoices). */
    subtotalAed: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    vatAed: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    totalAed: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    /** Company + customer details frozen at issue. */
    parties: jsonb().$type<InvoiceParties>(),
    notes: text(),
    issuedBy: uuid().references(() => users.id),
    issuedAt: timestamp({ withTimezone: true }),
    version: version(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("invoices_customer_idx").on(t.customerId), index("invoices_sale_idx").on(t.saleId), index("invoices_status_idx").on(t.status, t.dueDate)],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: id(),
    invoiceId: uuid().notNull().references(() => invoices.id, { onDelete: "cascade" }),
    saleLineId: uuid().notNull().references(() => saleLines.id),
    description: text().notNull(),
    qty: numeric({ precision: 16, scale: 4 }).notNull(),
    unitPrice: numeric({ precision: 14, scale: 4 }).notNull(),
    vatCategory: text().notNull(),
    vatRate: numeric({ precision: 5, scale: 2 }).notNull(),
    net: numeric({ precision: 14, scale: 2 }).notNull(),
    vat: numeric({ precision: 14, scale: 2 }).notNull(),
    total: numeric({ precision: 14, scale: 2 }).notNull(),
  },
  (t) => [index("invoice_lines_invoice_idx").on(t.invoiceId), index("invoice_lines_sale_line_idx").on(t.saleLineId)],
);

/** Append-only. Mistakes are fixed with a reversal row (negative amount, reversal_of set). */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    ref: text().notNull().unique(), // PAY-0001
    invoiceId: uuid().notNull().references(() => invoices.id),
    paymentDate: date({ mode: "string" }).notNull(),
    amount: numeric({ precision: 14, scale: 2 }).notNull(),
    method: text().notNull(), // cash | bank_transfer | cheque | card
    reference: text(),
    notes: text(),
    reversalOf: uuid(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("payments_invoice_idx").on(t.invoiceId)],
);
