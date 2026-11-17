import { z } from "zod";
import { VAT_CATEGORIES } from "@/lib/vat";

const optText = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const qty = z.string().trim().regex(/^\d{1,12}(\.\d{1,4})?$/, "Enter a valid quantity");
const price = z.string().trim().regex(/^\d{1,12}(\.\d{1,4})?$/, "Enter a valid price");

export const saleSchema = z.object({
  customerId: z.uuid("Choose a customer"),
  saleDate: z.iso.date("Choose the sale date"),
  containerId: z.string().transform((v) => v || null).pipe(z.uuid().nullable()),
  currency: z.enum(["AED", "USD", "EUR", "GBP", "INR", "CNY", "SAR", "PKR", "JPY"]),
  exchangeRate: z.string().trim().regex(/^\d{1,8}(\.\d{1,6})?$/, "Enter a valid exchange rate"),
  notes: optText(500),
});

export const saleLineSchema = z.object({
  saleId: z.uuid(),
  productId: z.string().transform((v) => v || null).pipe(z.uuid().nullable()),
  description: z.string().trim().max(200),
  qty, unitPrice: price,
  vatCategory: z.enum(VAT_CATEGORIES),
});

export const draftInvoiceSchema = z.object({
  saleId: z.uuid(),
  issueDate: z.iso.date("Choose the invoice date"),
  supplyDate: z.iso.date("Choose the supply date"),
  dueDate: z.string().trim().transform((v) => v || null).pipe(z.iso.date().nullable()),
  notes: optText(500),
});

export const paymentSchema = z.object({
  invoiceId: z.uuid(),
  paymentDate: z.iso.date("Choose the payment date"),
  amount: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter a valid amount"),
  method: z.enum(["bank_transfer", "cash", "cheque", "card"]),
  reference: optText(80),
  notes: optText(300),
});

export const expenseSchema = z.object({
  containerId: z.uuid("Choose a container"),
  type: z.enum(["freight", "customs_duty", "insurance", "port_charges", "thc", "delivery_order", "clearing", "transport", "labour", "other"]),
  description: optText(200),
  amount: price, currency: z.enum(["AED", "USD", "EUR", "GBP", "INR", "CNY", "SAR", "PKR", "JPY"]),
  exchangeRate: z.string().trim().regex(/^\d{1,8}(\.\d{1,6})?$/, "Enter a valid exchange rate"),
  vat: price.or(z.literal("")).transform((v) => v || "0"),
  incurredOn: z.iso.date("Choose the date"),
});
