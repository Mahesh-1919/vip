import { z } from "zod";

const qty = z.string().trim().regex(/^\d{1,12}(\.\d{1,4})?$/, "Enter a valid quantity");
const cost = z.string().trim().regex(/^(\d{1,10}(\.\d{1,4})?)?$/, "Enter a valid cost");
const optional = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const optDate = z.string().trim().transform((v) => v || null).pipe(z.iso.date().nullable());

export const productSchema = z.object({
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{1,39}$/, "SKU: 2-40 letters, digits, . _ -"),
  name: z.string().trim().min(2, "Name is required").max(150),
  description: optional(500),
  categoryId: z.string().transform((v) => v || null).pipe(z.uuid().nullable()),
  baseUomId: z.uuid("Choose a unit of measure"),
  tracking: z.enum(["quantity", "batch", "serial"]),
  hsCode: optional(20),
  barcode: optional(40),
  reorderLevel: z.string().trim().regex(/^\d{1,12}(\.\d{1,4})?$/, "Enter a valid number").default("0"),
  version: z.coerce.number().int().positive().optional(),
});

export const packagingSchema = z.object({ productId: z.uuid(), name: z.string().trim().min(2).max(60), qty: z.string().trim().regex(/^\d{1,10}(\.\d{1,4})?$/, "Enter a valid quantity") });

export const entrySchema = z.object({
  kind: z.enum(["opening", "inward", "adjustment_in", "adjustment_out"]),
  productId: z.uuid("Choose a product"),
  warehouseId: z.uuid("Choose a warehouse"),
  qty,
  packagingId: z.string().transform((v) => v || null).pipe(z.uuid().nullable()),
  unitCost: cost.transform((v) => v || null),
  lotNo: optional(60),
  expiryDate: optDate,
  serials: z.string().transform((v) => [...new Set(v.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))]),
  note: optional(300),
});

export const transferSchema = z.object({
  productId: z.uuid("Choose a product"), fromWarehouseId: z.uuid(), toWarehouseId: z.uuid(), qty,
  packagingId: z.string().transform((v) => v || null).pipe(z.uuid().nullable()),
  lotNo: optional(60), note: optional(300),
});

export const warehouseSchema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,12}$/, "Code: 2-12 letters/digits"), name: z.string().trim().min(2).max(100), address: optional(200) });
export const uomSchema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,8}$/, "Code: 1-8 letters/digits"), name: z.string().trim().min(2).max(40), kind: z.enum(["count", "weight", "volume", "length", "pack"]) });
