import { pgTable, pgEnum, text, boolean, numeric, uuid, bigint, timestamp, date, index, uniqueIndex } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, version } from "./_columns";
import { users } from "./auth";

export const trackingType = pgEnum("tracking_type", ["quantity", "batch", "serial"]);
export const moveType = pgEnum("stock_move_type", ["opening", "inward", "outward", "adjustment_in", "adjustment_out", "transfer_in", "transfer_out"]);

/** Units of measure. Stock is always held in the product's base UoM; packagings convert to it. */
export const uoms = pgTable("uoms", {
  id: id(),
  code: text().notNull().unique(), // PCS, KG, L, BOX, CTN, CNT ...
  name: text().notNull(),
  kind: text().notNull().default("count"), // count | weight | volume | length | pack (informational)
  /** false = whole numbers only (pieces, boxes); true = decimals allowed (kg, litres). */
  allowDecimal: boolean().notNull().default(false),
  isActive: boolean().notNull().default(true),
});

export const productCategories = pgTable("product_categories", {
  id: id(),
  name: text().notNull().unique(),
});

export const warehouses = pgTable("warehouses", {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  address: text(),
  isDefault: boolean().notNull().default(false),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
});

export const products = pgTable(
  "products",
  {
    id: id(),
    sku: text().notNull().unique(),
    name: text().notNull(),
    description: text(),
    categoryId: uuid().references(() => productCategories.id),
    baseUomId: uuid().notNull().references(() => uoms.id),
    tracking: trackingType().notNull().default("quantity"),
    hsCode: text(), // customs tariff code
    barcode: text(),
    reorderLevel: numeric({ precision: 16, scale: 4 }).notNull().default("0"),
    /** Weighted-average cost per base unit, AED. Updated on every costed inward move. */
    avgCost: numeric({ precision: 14, scale: 4 }).notNull().default("0"),
    isActive: boolean().notNull().default(true),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("products_category_idx").on(t.categoryId)],
);

/** "Box of 12", "Carton of 24", "Pallet of 480": how many base units one pack holds. */
export const productPackagings = pgTable(
  "product_packagings",
  {
    id: id(),
    productId: uuid().notNull().references(() => products.id, { onDelete: "cascade" }),
    name: text().notNull(),
    qty: numeric({ precision: 16, scale: 4 }).notNull(),
  },
  (t) => [uniqueIndex("packaging_product_name_uq").on(t.productId, t.name)],
);

/** A batch/lot number, or a serial number (one unit). */
export const stockLots = pgTable(
  "stock_lots",
  {
    id: id(),
    productId: uuid().notNull().references(() => products.id),
    lotNo: text().notNull(),
    expiryDate: date({ mode: "string" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("stock_lot_uq").on(t.productId, t.lotNo)],
);

/** Current quantity per product/warehouse/lot. A DB CHECK (qty >= 0) makes negative stock impossible. */
export const stockLevels = pgTable(
  "stock_levels",
  {
    id: id(),
    productId: uuid().notNull().references(() => products.id),
    warehouseId: uuid().notNull().references(() => warehouses.id),
    lotId: uuid().references(() => stockLots.id),
    /** lotId or '' so the unique key works for non-lot-tracked stock. */
    lotKey: text().notNull().default(""),
    qty: numeric({ precision: 16, scale: 4 }).notNull().default("0"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("stock_level_uq").on(t.productId, t.warehouseId, t.lotKey), index("stock_level_wh_idx").on(t.warehouseId)],
);

/** Append-only ledger (DB trigger blocks UPDATE/DELETE). Corrections are made with reversing moves. */
export const stockMoves = pgTable(
  "stock_moves",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    productId: uuid().notNull().references(() => products.id),
    warehouseId: uuid().notNull().references(() => warehouses.id),
    lotId: uuid().references(() => stockLots.id),
    type: moveType().notNull(),
    /** Signed, in base UoM: positive = stock in, negative = stock out. */
    qty: numeric({ precision: 16, scale: 4 }).notNull(),
    /** Cost per base unit (AED) at the time of the move. */
    unitCost: numeric({ precision: 14, scale: 4 }).notNull().default("0"),
    refType: text(), // container | invoice | manual | transfer ...
    refId: text(),
    /** What the user typed, e.g. "5 × Box of 12". */
    enteredAs: text(),
    note: text(),
    movedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid().references(() => users.id),
  },
  (t) => [index("stock_moves_product_idx").on(t.productId, t.movedAt), index("stock_moves_ref_idx").on(t.refType, t.refId)],
);
