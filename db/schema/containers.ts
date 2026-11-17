import { pgTable, pgEnum, text, boolean, numeric, uuid, integer, date, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, version } from "./_columns";
import { users } from "./auth";
import { products, warehouses } from "./inventory";

export const containerDirection = pgEnum("container_direction", ["inward", "outward"]);
/** inward: in_transit → at_port → cleared → received · outward: packing → dispatched → shipped → delivered */
export const containerStatus = pgEnum("container_status", ["in_transit", "at_port", "cleared", "received", "packing", "dispatched", "shipped", "delivered", "cancelled"]);
export const costBasis = pgEnum("cost_allocation_basis", ["value", "quantity", "weight", "volume"]);

export const suppliers = pgTable("suppliers", {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  contactName: text(),
  email: text(),
  phone: text(),
  address: text(),
  country: text(), // ISO-3166 alpha-2
  taxId: text(), // TRN or foreign tax number
  paymentTermsDays: integer().notNull().default(30),
  isActive: boolean().notNull().default(true),
  version: version(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const customers = pgTable("customers", {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  contactName: text(),
  email: text(),
  phone: text(),
  address: text(),
  country: text(),
  /** UAE TRN (15 digits) or the customer's foreign tax ID. */
  taxId: text(),
  creditDays: integer().notNull().default(30),
  creditLimit: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
  isActive: boolean().notNull().default(true),
  version: version(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const containers = pgTable(
  "containers",
  {
    id: id(),
    /** Internal gap-free reference: IMP-0001 / EXP-0001. */
    ref: text().notNull().unique(),
    direction: containerDirection().notNull(),
    containerNo: text().notNull(), // ISO 6346
    sealNo: text(),
    size: text().notNull().default("40HC"),
    shippingLine: text(),
    vessel: text(),
    voyage: text(),
    billOfLading: text(),
    supplierId: uuid().references(() => suppliers.id),
    customerId: uuid().references(() => customers.id),
    incoterm: text(),
    originCountry: text(),
    loadPort: text(),
    dischargePort: text(),
    /** Warehouse stock is received into (inward) or dispatched from (outward). */
    warehouseId: uuid().references(() => warehouses.id),
    eta: date({ mode: "string" }),
    arrivalDate: date({ mode: "string" }), // inward: actual arrival
    dispatchDate: date({ mode: "string" }), // outward: actual dispatch
    customsDeclarationNo: text(),
    freeZone: boolean().notNull().default(false),
    currency: text().notNull().default("AED"),
    /** Units of AED per 1 unit of `currency` (AED = 1; USD is pegged at 3.6725). */
    exchangeRate: numeric({ precision: 14, scale: 6 }).notNull().default("1"),
    status: containerStatus().notNull(),
    /** Set once stock has been posted (received / dispatched). Locks the item list. */
    stockPostedAt: timestamp({ withTimezone: true }),
    notes: text(),
    version: version(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("containers_no_idx").on(t.containerNo), index("containers_status_idx").on(t.direction, t.status), index("containers_supplier_idx").on(t.supplierId), index("containers_customer_idx").on(t.customerId)],
);

export const containerItems = pgTable(
  "container_items",
  {
    id: id(),
    containerId: uuid().notNull().references(() => containers.id, { onDelete: "restrict" }),
    productId: uuid().notNull().references(() => products.id),
    /** Base units. */
    qty: numeric({ precision: 16, scale: 4 }).notNull(),
    enteredAs: text(),
    /** Price per base unit in the container's currency (supplier cost for inward, selling price for outward). */
    unitPrice: numeric({ precision: 14, scale: 4 }).notNull().default("0"),
    lotNo: text(),
    expiryDate: date({ mode: "string" }),
    serials: jsonb().$type<string[]>(),
    weightKg: numeric({ precision: 14, scale: 3 }).notNull().default("0"),
    volumeCbm: numeric({ precision: 14, scale: 3 }).notNull().default("0"),
    hsCode: text(),
    /** Snapshot taken when inward stock is posted: landed cost per base unit in AED. */
    landedUnitCostAed: numeric({ precision: 14, scale: 4 }),
    createdAt: createdAt(),
  },
  (t) => [index("container_items_container_idx").on(t.containerId)],
);

/** Freight, duty, insurance, port charges, etc. Feeds landed cost (inward) and per-container P&L (all). */
export const containerCosts = pgTable(
  "container_costs",
  {
    id: id(),
    containerId: uuid().notNull().references(() => containers.id, { onDelete: "restrict" }),
    type: text().notNull(), // freight | customs_duty | insurance | port_charges | thc | delivery_order | clearing | transport | labour | other
    description: text(),
    payeeSupplierId: uuid().references(() => suppliers.id),
    amount: numeric({ precision: 14, scale: 2 }).notNull(),
    currency: text().notNull().default("AED"),
    exchangeRate: numeric({ precision: 14, scale: 6 }).notNull().default("1"),
    amountAed: numeric({ precision: 14, scale: 2 }).notNull(),
    /** Recoverable VAT on this cost (e.g. import VAT on duty-paid goods); excluded from landed cost. */
    vatAed: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    allocation: costBasis().notNull().default("value"),
    /** Include in inventory landed cost (inward). Off = expensed only (e.g. demurrage, labour). */
    inLandedCost: boolean().notNull().default(true),
    incurredOn: date({ mode: "string" }).notNull(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("container_costs_container_idx").on(t.containerId)],
);
