import { pgTable, text, integer } from "drizzle-orm/pg-core";
import { updatedAt } from "./_columns";

/** Single-row company profile (id is always 1), printed on payslips. */
export const companySettings = pgTable("company_settings", {
  id: integer().primaryKey().default(1),
  name: text().notNull().default("Your Company LLC"),
  address: text().notNull().default("Sharjah, United Arab Emirates"),
  phone: text(),
  email: text(),
  /** UAE Tax Registration Number (15 digits): required to issue tax invoices. */
  trn: text(),
  bankName: text(),
  iban: text(),
  invoiceTerms: text(),
  updatedAt: updatedAt(),
});
