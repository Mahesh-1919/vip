import { z } from "zod";

export const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"] as const;
export const CONTAINER_SIZES = ["20GP", "40GP", "40HC", "20RF", "40RF", "45HC", "LCL", "Other"] as const;
export const CURRENCIES = ["AED", "USD", "EUR", "GBP", "INR", "CNY", "SAR", "PKR", "JPY"] as const;
export const COST_TYPE_LABELS: Record<string, string> = {
  freight: "Freight", customs_duty: "Customs duty", insurance: "Insurance", port_charges: "Port charges", thc: "Terminal handling (THC)",
  delivery_order: "Delivery order", clearing: "Clearing / agent fee", transport: "Local transport", labour: "Labour", other: "Other",
};

const opt = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const optDate = z.string().trim().transform((v) => v || null).pipe(z.iso.date().nullable());
const country = z.string().trim().toUpperCase().transform((v) => v || null).pipe(z.string().regex(/^[A-Z]{2}$/, "Use a 2-letter country code, e.g. IN, CN, AE").nullable());
const money = z.string().trim().regex(/^\d{1,12}(\.\d{1,4})?$/, "Enter a valid amount");
const qty = z.string().trim().regex(/^\d{1,12}(\.\d{1,4})?$/, "Enter a valid quantity");

export const containerSchema = z.object({
  direction: z.enum(["inward", "outward"]),
  containerNo: z.string().trim().min(1, "Container number is required").max(20),
  sealNo: opt(30),
  size: z.enum(CONTAINER_SIZES),
  shippingLine: opt(80), vessel: opt(80), voyage: opt(30), billOfLading: opt(40),
  partyId: z.uuid("Choose the supplier / customer"),
  incoterm: z.string().trim().transform((v) => v || null).pipe(z.enum(INCOTERMS).nullable()),
  originCountry: country,
  loadPort: opt(80), dischargePort: opt(80),
  warehouseId: z.string().transform((v) => v || null).pipe(z.uuid().nullable()),
  eta: optDate,
  customsDeclarationNo: opt(40),
  freeZone: z.string().optional().transform((v) => v === "on"),
  currency: z.enum(CURRENCIES),
  exchangeRate: z.string().trim().regex(/^\d{1,8}(\.\d{1,6})?$/, "Enter a valid exchange rate"),
  notes: opt(500),
  version: z.coerce.number().int().positive().optional(),
});

export const itemSchema = z.object({
  containerId: z.uuid(), productId: z.uuid("Choose a product"), qty: qty.or(z.literal("")).transform((v) => v || "0"),
  packagingId: z.string().transform((v) => v || null).pipe(z.uuid().nullable()),
  unitPrice: money,
  lotNo: opt(60), expiryDate: optDate,
  serials: z.string().transform((v) => [...new Set(v.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))]),
  weightKg: money.or(z.literal("")).transform((v) => v || "0"), volumeCbm: money.or(z.literal("")).transform((v) => v || "0"),
});

export const costSchema = z.object({
  containerId: z.uuid(),
  type: z.enum(["freight", "customs_duty", "insurance", "port_charges", "thc", "delivery_order", "clearing", "transport", "labour", "other"]),
  description: opt(200),
  payeeSupplierId: z.string().transform((v) => v || null).pipe(z.uuid().nullable()),
  amount: money, currency: z.enum(CURRENCIES), exchangeRate: z.string().trim().regex(/^\d{1,8}(\.\d{1,6})?$/, "Enter a valid exchange rate"),
  vat: money.or(z.literal("")).transform((v) => v || "0"),
  allocation: z.enum(["value", "quantity", "weight", "volume"]),
  inLandedCost: z.string().optional().transform((v) => v === "on"),
  incurredOn: z.iso.date("Choose the date"),
});

export const partySchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,16}$/, "Code: 2-16 letters/digits"),
  name: z.string().trim().min(2, "Name is required").max(150),
  contactName: opt(100), email: z.string().trim().toLowerCase().max(254).transform((v) => v || null).pipe(z.email().nullable()), phone: opt(30), address: opt(300),
  country,
  taxId: opt(30),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
  creditDays: z.coerce.number().int().min(0).max(365).optional(),
  creditLimit: z.string().trim().regex(/^(\d{1,12}(\.\d{1,2})?)?$/, "Enter a valid amount").optional(),
  version: z.coerce.number().int().positive().optional(),
});
