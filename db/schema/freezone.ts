import { pgTable, text, numeric, integer, date, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, version } from "./_columns";
import { users } from "./auth";

/** Free Zone Entry Bill Sheet: one row per bill of entry (goods coming into the zone). */
export const entryBills = pgTable(
  "entry_bills",
  {
    id: id(),
    billDate: date({ mode: "string" }).notNull(),
    billNo: text().notNull(),
    agentName: text(),
    transferNo: text(),
    arrivalDate: date({ mode: "string" }),
    portOfLoading: text(),
    portOfDischarge: text(),
    invoiceNo: text(),
    /** Invoice value in AED. */
    valueAed: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    weightKg: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    packages: integer().notNull().default(0),
    /** Country of origin code (the sheet's STOCK column): CN, TR, BH ... */
    originCountry: text(),
    /** Marks & numbers: container numbers, comma separated. */
    marksNumbers: text(),
    /** Line / destination (OMAN, SAUDI, EGYPT ...). */
    line: text(),
    notes: text(),
    version: version(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("entry_bill_no_uq").on(t.billNo), index("entry_bill_date_idx").on(t.billDate), index("entry_agent_idx").on(t.agentName)],
);

/** Free Zone Exit Bill Sheet: one row per bill of exit. */
export const exitBills = pgTable(
  "exit_bills",
  {
    id: id(),
    exitDate: date({ mode: "string" }).notNull(),
    boeNo: text().notNull(),
    importerName: text(),
    refNo: text(),
    /** IMPORT | EXPORT */
    billType: text().notNull().default("EXPORT"),
    portOfLoading: text(),
    portOfDischarge: text(),
    invoiceNo: text(),
    valueAed: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    weightKg: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    packages: integer().notNull().default(0),
    country: text(),
    /** Truck / container number(s). */
    truckContainerNo: text(),
    /** Transfer/entry certificate: Pending | Received | No Need */
    entryCertStatus: text().notNull().default("Pending"),
    chequeDate: date({ mode: "string" }),
    chequeAmount: numeric({ precision: 14, scale: 2 }),
    /** Pending | Refund Received | No Need */
    refundStatus: text().notNull().default("Pending"),
    shippingLine: text(),
    notes: text(),
    version: version(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("exit_boe_no_uq").on(t.boeNo), index("exit_date_idx").on(t.exitDate), index("exit_importer_idx").on(t.importerName)],
);
