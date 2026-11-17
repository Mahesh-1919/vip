import { z } from "zod";

const text = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const optDate = z.string().trim().optional().transform((v) => v || null).pipe(z.iso.date().nullable());

export const customerSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(150),
  contactName: text(100),
  email: z.string().trim().toLowerCase().max(254).optional().transform((v) => v || null).pipe(z.email().nullable()),
  phone: text(30), address: text(300),
  trn: z.string().trim().optional().transform((v) => (v ?? "").replace(/\s/g, "")).pipe(z.union([z.literal(""), z.string().regex(/^\d{15}$/, "TRN must be 15 digits")])).transform((v) => v || null),
  creditDays: z.coerce.number().int().min(0).max(365).default(30),
  version: z.coerce.number().int().positive().optional(),
});

export const saleHeaderSchema = z.object({
  customerId: z.uuid("Choose a customer"),
  saleDate: z.iso.date("Choose the sale date"),
  billRef: text(80), notes: text(500),
  version: z.coerce.number().int().positive().optional(),
});

export const MAX_LINES = 8;
const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "enter a valid number");

/** Reads `desc:n`, `qty:n`, `price:n`, `vat:n` rows from the form; blank rows are skipped. */
export function parseLines(form: FormData): { ok: true; lines: { description: string; qty: string; unitPrice: string; vatRate: string }[] } | { ok: false; error: string } {
  const lines = [];
  for (let n = 0; n < MAX_LINES; n++) {
    const description = String(form.get(`desc:${n}`) ?? "").trim();
    const qty = String(form.get(`qty:${n}`) ?? "").trim().replace(/,/g, "");
    const price = String(form.get(`price:${n}`) ?? "").trim().replace(/,/g, "");
    if (!description && !qty && !price) continue;
    if (!description) return { ok: false, error: `Line ${n + 1}: enter a description` };
    if (!money.safeParse(qty).success || Number(qty) <= 0) return { ok: false, error: `Line ${n + 1}: quantity ${qty ? "must be above zero" : "is required"}` };
    if (!money.safeParse(price).success) return { ok: false, error: `Line ${n + 1}: unit price ${price ? "is not a valid number" : "is required"}` };
    const vat = String(form.get(`vat:${n}`) ?? "5");
    if (vat !== "5" && vat !== "0") return { ok: false, error: `Line ${n + 1}: invalid VAT rate` };
    lines.push({ description: description.slice(0, 200), qty, unitPrice: price, vatRate: vat });
  }
  return lines.length ? { ok: true, lines } : { ok: false, error: "Add at least one line" };
}

export const invoiceFormSchema = z.object({ saleId: z.uuid(), issueDate: z.iso.date("Choose the invoice date"), dueDate: optDate, notes: text(500) });
export const paymentSchema = z.object({
  invoiceId: z.uuid(), paymentDate: z.iso.date("Choose the payment date"),
  amount: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter a valid amount"),
  method: z.enum(["bank_transfer", "cash", "cheque", "card"]), reference: text(80),
});
