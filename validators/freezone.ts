import { z } from "zod";

const text = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const date = z.iso.date("Choose a valid date");
const optDate = z.string().trim().optional().transform((v) => v || null).pipe(z.iso.date().nullable());
const amount = z.string().trim().optional().transform((v) => (v ?? "").replace(/,/g, "") || "0").pipe(z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter a valid number"));
const int = z.string().trim().optional().transform((v) => (v ?? "").replace(/,/g, "") || "0").pipe(z.string().regex(/^\d{1,9}$/, "Enter a whole number"));
const country = z.string().trim().max(40).optional().transform((v) => (v ?? "").toUpperCase() || null);

export const entrySchema = z.object({
  billDate: date,
  billNo: z.string().trim().min(1, "Bill number is required").max(60),
  agentName: text(120), transferNo: text(60), arrivalDate: optDate,
  portOfLoading: text(80), portOfDischarge: text(80), invoiceNo: text(80),
  valueAed: amount, weightKg: amount, packages: int,
  originCountry: country, marksNumbers: text(500), line: text(60), notes: text(500),
  packagesReason: text(200),
  version: z.coerce.number().int().positive().optional(),
});

export const BILL_TYPES = ["IMPORT", "EXPORT"] as const;
export const CERT_STATUSES = ["Pending", "Received", "No Need"] as const;
export const REFUND_STATUSES = ["Pending", "Refund Received", "No Need"] as const;

export const exitSchema = z.object({
  exitDate: date,
  boeNo: z.string().trim().min(1, "BOE number is required").max(60),
  importerName: text(150), refNo: text(60),
  customerId: z.string().optional().transform((v) => v || null).pipe(z.uuid().nullable()),
  billType: z.enum(BILL_TYPES),
  portOfLoading: text(80), portOfDischarge: text(80), invoiceNo: text(80),
  valueAed: amount, weightKg: amount, packages: int,
  country: country, truckContainerNo: text(300),
  entryCertStatus: z.enum(CERT_STATUSES),
  chequeDate: optDate, chequeAmount: z.string().trim().optional().transform((v) => (v ?? "").replace(/,/g, "")).pipe(z.union([z.literal(""), z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter a valid number")])).transform((v) => v || null),
  refundStatus: z.enum(REFUND_STATUSES),
  shippingLine: text(80), notes: text(500),
  version: z.coerce.number().int().positive().optional(),
});

export const allocationSchema = z.object({
  exitBillId: z.uuid(), entryBillId: z.uuid("Choose the entry bill"),
  packages: z.string().trim().regex(/^\d{1,9}$/, "Packages must be a whole number").transform(Number),
  weightKg: amount,
});

/** New export bill taken straight from stock: the entry bill supplies the packages. Bill type is always EXPORT. */
export const exitFromStockSchema = exitSchema.omit({ billType: true, importerName: true, packages: true, customerId: true, version: true }).extend({
  entryBillId: z.uuid("Choose the entry bill (import) the goods come from"),
  customerId: z.uuid("Choose the customer"),
  packages: z.string().trim().regex(/^\d{1,9}$/, "Packages must be a whole number").transform(Number).pipe(z.number().int().min(1, "Enter at least 1 package")),
});
