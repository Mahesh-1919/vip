/* Idempotent seed. Run: npm run db:seed   (DEV ONLY demo credentials) */
import { eq, sql as dsql } from "drizzle-orm";
import { db, sql } from "./index";
import { roles, rolePermissions, users, departments, salaryComponents, employees, employeeSalaries, employeeSalaryLines } from "./schema";
import { shifts, shiftAssignments, holidayCalendars, holidays, leaveTypes, leaveBalances, leaveRequests, attendance } from "./schema";
import { uoms, productCategories, warehouses, products, productPackagings } from "./schema";
import { postMove } from "../services/inventory/stock";
import { suppliers, customers } from "./schema";
import * as containerSvc from "../services/inventory/containers";
import { iso6346CheckDigit } from "../lib/container";
import { companySettings, containers as containersT, saleLines, sales as salesT } from "./schema";
import * as salesSvc from "../services/sales/sales";
import { backfillLedger } from "../services/accounting/backfill";
import * as invSvc from "../services/sales/invoicing";
import { encryptField } from "../lib/crypto";
import { nextNumber } from "../lib/numbering";
import { DEFAULT_ROLES } from "../lib/rbac";
import { hashPassword } from "../lib/password";

const USERS = [
  { email: "admin@erp.local", name: "Aisha Admin", role: "admin" },
  { email: "hr@erp.local", name: "Hana HR", role: "hr_manager" },
  { email: "inventory@erp.local", name: "Imran Inventory", role: "inventory_manager" },
  { email: "sales@erp.local", name: "Sara Sales", role: "sales_manager" },
  { email: "accountant@erp.local", name: "Ali Accountant", role: "accountant" },
];

const DEPTS = ["Management", "Sales", "Operations & Logistics", "Warehouse", "Accounts & Finance", "HR & Admin"];
const COMPONENTS = [
  { code: "HOUSING", name: "Housing allowance", type: "allowance", calc: "percent_of_basic", defaultValue: "25.00" },
  { code: "TRANSPORT", name: "Transport allowance", type: "allowance", calc: "fixed", defaultValue: "500.00" },
  { code: "PHONE", name: "Phone allowance", type: "allowance", calc: "fixed", defaultValue: "150.00" },
  { code: "ADVANCE", name: "Salary advance recovery", type: "deduction", calc: "fixed", defaultValue: "0.00" },
  { code: "FINE", name: "Fines / penalties", type: "deduction", calc: "fixed", defaultValue: "0.00" },
] as const;
const EMPLOYEES = [
  { name: "Mohammed Rafiq", dept: "Operations & Logistics", desig: "Logistics Manager", nat: "India", join: "2021-03-01", basic: "6000", lines: { HOUSING: "25", TRANSPORT: "600" }, eid: "784198512345671", bank: "Emirates NBD", iban: "AE070331234567890123456" },
  { name: "Fatima Al Mansoori", dept: "Accounts & Finance", desig: "Senior Accountant", nat: "UAE", join: "2020-09-15", basic: "9000", lines: { HOUSING: "25", TRANSPORT: "800", PHONE: "200" }, eid: "784199012345672", bank: "ADCB", iban: "AE460030123456789012345" },
  { name: "Rajesh Kumar", dept: "Warehouse", desig: "Warehouse Supervisor", nat: "India", join: "2022-01-10", basic: "3500", lines: { HOUSING: "20", TRANSPORT: "300" }, eid: "784198812345673", bank: "Mashreq", iban: "AE260330123456789012346" },
  { name: "Svetlana Petrova", dept: "Sales", desig: "Sales Executive", nat: "Russia", join: "2023-05-20", basic: "7000", lines: { HOUSING: "25", PHONE: "150" }, eid: "784199212345674", bank: "FAB", iban: "AE210351234567890123457" },
  { name: "Omar Hassan", dept: "HR & Admin", desig: "HR Officer", nat: "Egypt", join: "2022-07-01", basic: "5500", lines: { HOUSING: "25", TRANSPORT: "400" }, eid: "784198712345675", bank: "Dubai Islamic Bank", iban: "AE480240123456789012348" },
];

async function seedHr() {
  await db.insert(departments).values(DEPTS.map((name) => ({ name }))).onConflictDoNothing();
  await db.insert(salaryComponents).values([...COMPONENTS]).onConflictDoNothing();
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(employees);
  if (n > 0) return;
  const depts = await db.select().from(departments);
  const comps = await db.select().from(salaryComponents);
  for (const e of EMPLOYEES) {
    await db.transaction(async (tx) => {
      const empCode = await nextNumber(tx, "employee", "EMP-");
      const [row] = await tx.insert(employees).values({
        empCode, name: e.name, nationality: e.nat, gender: ["Fatima Al Mansoori", "Svetlana Petrova"].includes(e.name) ? "female" : "male", joinDate: e.join, designation: e.desig,
        departmentId: depts.find((d) => d.name === e.dept)?.id, email: `${e.name.split(" ")[0].toLowerCase()}@example.com`,
        phone: "+971 50 123 4567", emiratesIdEnc: encryptField(e.eid), bankName: e.bank, ibanEnc: encryptField(e.iban),
        labourCardNo: `LC${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`,
        // Spread of expiry dates so the alerts show up in the demo
        visaExpiry: new Date(Date.now() + (Math.random() * 400 - 20) * 86400000).toISOString().slice(0, 10),
        emiratesIdExpiry: new Date(Date.now() + 500 * 86400000).toISOString().slice(0, 10),
      }).returning();
      const [sal] = await tx.insert(employeeSalaries).values({ employeeId: row.id, effectiveFrom: e.join, basic: e.basic }).returning();
      const lines = Object.entries(e.lines).map(([code, value]) => ({ salaryId: sal.id, componentId: comps.find((c) => c.code === code)!.id, value }));
      await tx.insert(employeeSalaryLines).values(lines);
    });
  }
}

const LEAVE_TYPES = [
  { code: "ANNUAL", name: "Annual leave", annualQuota: "30", accrual: "monthly", payMode: "paid", carryForward: true, carryForwardMax: "10", minServiceMonths: 6 },
  { code: "SICK", name: "Sick leave", annualQuota: "90", accrual: "annual_upfront", payMode: "tiered", payTiers: [{ upToDays: 15, payPercent: 100 }, { upToDays: 45, payPercent: 50 }, { upToDays: 90, payPercent: 0 }], minServiceMonths: 3 },
  { code: "CASUAL", name: "Casual leave", annualQuota: "6", accrual: "annual_upfront", payMode: "paid" },
  { code: "UNPAID", name: "Unpaid leave", annualQuota: "0", accrual: "annual_upfront", payMode: "unpaid" },
  { code: "MATERNITY", name: "Maternity leave", annualQuota: "60", accrual: "annual_upfront", payMode: "tiered", payTiers: [{ upToDays: 45, payPercent: 100 }, { upToDays: 60, payPercent: 50 }], allowHalfDay: false, gender: "female" },
  { code: "PATERNITY", name: "Paternity leave", annualQuota: "5", accrual: "annual_upfront", payMode: "paid", allowHalfDay: false, gender: "male" },
  { code: "BEREAVEMENT", name: "Bereavement leave", annualQuota: "5", accrual: "annual_upfront", payMode: "paid", allowHalfDay: false },
] as const;

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function seedAttendance() {
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(shifts);
  if (n > 0) return;
  const [general, warehouse] = await db.insert(shifts).values([
    { name: "General (09:00-18:00)", startTime: "09:00", endTime: "18:00", graceMinutes: 15, breakMinutes: 60, weeklyOff: [0, 6] },
    { name: "Warehouse (07:00-16:00)", startTime: "07:00", endTime: "16:00", graceMinutes: 10, breakMinutes: 60, weeklyOff: [0] },
    { name: "Ramadan hours (09:00-15:00)", startTime: "09:00", endTime: "15:00", graceMinutes: 15, breakMinutes: 0, weeklyOff: [0, 6] },
  ]).returning();
  const [cal] = await db.insert(holidayCalendars).values({ name: "UAE Public Holidays", isDefault: true }).returning();
  // Fixed-date holidays only. Islamic holidays move with moon sighting: add them from /hr/holidays once announced.
  const fixed: [string, string][] = [];
  for (const y of [2026, 2027]) fixed.push([`${y}-01-01`, "New Year's Day"], [`${y}-12-02`, "UAE National Day"], [`${y}-12-03`, "UAE National Day"]);
  await db.insert(holidays).values(fixed.map(([date, name]) => ({ calendarId: cal.id, date, name })));
  await db.insert(leaveTypes).values(LEAVE_TYPES.map((t) => ({ ...t, payTiers: "payTiers" in t ? [...t.payTiers] : null })) as never);

  const emps = await db.select().from(employees);
  await db.insert(shiftAssignments).values(emps.map((e) => ({
    employeeId: e.id, shiftId: e.name === "Rajesh Kumar" ? warehouse.id : general.id, effectiveFrom: e.joinDate,
  })));

  // 30 days of attendance (deterministic pseudo-random)
  const rand = rng(42);
  const holidaySet = new Set(fixed.map(([d]) => d));
  const rows: (typeof attendance.$inferInsert)[] = [];
  for (let back = 30; back >= 1; back--) {
    const date = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
    const wd = new Date(date + "T00:00:00Z").getUTCDay();
    for (const e of emps) {
      const off = e.name === "Rajesh Kumar" ? [0] : [0, 6];
      if (off.includes(wd) || holidaySet.has(date) || e.joinDate > date) continue;
      const r = rand();
      const status = r < 0.82 ? "present" : r < 0.9 ? "late" : r < 0.95 ? "half_day" : "absent";
      rows.push({ employeeId: e.id, date, status, checkIn: status === "late" ? "09:40" : status === "absent" ? null : "08:55" });
    }
  }
  await db.insert(attendance).values(rows).onConflictDoNothing();

  // A pending annual-leave request and an approved sick leave in the past
  const types = await db.select().from(leaveTypes);
  const t = (c: string) => types.find((x) => x.code === c)!;
  const omar = emps.find((e) => e.name === "Omar Hassan")!, fatima = emps.find((e) => e.name === "Fatima Al Mansoori")!;
  const plus = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  await db.insert(leaveRequests).values({ employeeId: omar.id, leaveTypeId: t("ANNUAL").id, fromDate: plus(14), toDate: plus(14), days: "1", reason: "Family event" });
  const year = new Date().getUTCFullYear();
  await db.insert(leaveBalances).values({ employeeId: fatima.id, leaveTypeId: t("SICK").id, year, allocated: "90", used: "2" }).onConflictDoNothing();
}

const UOMS = [
  { code: "PCS", name: "Piece", kind: "count", allowDecimal: false }, { code: "SET", name: "Set", kind: "count", allowDecimal: false },
  { code: "BOX", name: "Box", kind: "pack", allowDecimal: false }, { code: "CTN", name: "Carton", kind: "pack", allowDecimal: false },
  { code: "CNT", name: "Container", kind: "pack", allowDecimal: false },
  { code: "KG", name: "Kilogram", kind: "weight", allowDecimal: true }, { code: "TON", name: "Tonne", kind: "weight", allowDecimal: true },
  { code: "L", name: "Litre", kind: "volume", allowDecimal: true }, { code: "M", name: "Metre", kind: "length", allowDecimal: true },
];
const CATEGORIES = ["Food & Beverage", "Electronics", "Textiles", "Building Materials", "Consumer Goods"];
const PRODUCTS = [
  { sku: "RICE-BAS", name: "Basmati Rice (bulk)", cat: "Food & Beverage", uom: "KG", tracking: "quantity", reorder: "2000", hs: "1006.30", packs: [["Bag 25kg", "25"], ["Bag 5kg", "5"]], open: [["JAFZA", "12500", "3.8"], ["ALQ", "3000", "3.9"]] },
  { sku: "OIL-SUN-1L", name: "Sunflower Oil 1L", cat: "Food & Beverage", uom: "L", tracking: "batch", reorder: "500", hs: "1512.19", packs: [["Carton of 12 L", "12"]], open: [["JAFZA", "2400", "5.2", "OIL-2406-A", "2027-06-30"], ["JAFZA", "1200", "5.4", "OIL-2409-B", "2027-09-30"]] },
  { sku: "TEA-CTC", name: "Tea CTC 400g box", cat: "Food & Beverage", uom: "BOX", tracking: "batch", reorder: "300", hs: "0902.30", packs: [["Pallet of 40 boxes", "40"]], open: [["JAFZA", "800", "9.5", "TEA-2403", "2026-12-15"]] },
  { sku: "TV-LED55", name: "LED TV 55-inch", cat: "Electronics", uom: "PCS", tracking: "serial", reorder: "5", hs: "8528.72", packs: [], open: [["JAFZA", "3", "1150", ["TV55-0001", "TV55-0002", "TV55-0003"]]] },
  { sku: "PHN-A15", name: "Smartphone A15 128GB", cat: "Electronics", uom: "PCS", tracking: "serial", reorder: "10", hs: "8517.13", packs: [], open: [["JAFZA", "12", "640", Array.from({ length: 12 }, (_, i) => `A15-${String(i + 1).padStart(5, "0")}`)]] },
  { sku: "BAT-AA4", name: "AA Batteries 4-pack", cat: "Consumer Goods", uom: "PCS", tracking: "quantity", reorder: "1000", hs: "8506.10", packs: [["Carton of 24", "24"]], open: [["ALQ", "6000", "4.1"]] },
  { sku: "FAB-COT", name: "Cotton Fabric 150cm", cat: "Textiles", uom: "M", tracking: "quantity", reorder: "1000", hs: "5208.32", packs: [["Roll of 50 m", "50"]], open: [["ALQ", "8200", "6.75"]] },
  { sku: "TILE-60", name: "Ceramic Tile 60x60 (box of 4)", cat: "Building Materials", uom: "BOX", tracking: "quantity", reorder: "100", hs: "6907.21", packs: [["Pallet of 48 boxes", "48"]], open: [["JAFZA", "60", "38"]] },
] as const;

async function seedInventory() {
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(products);
  if (n > 0) return;
  await db.insert(uoms).values(UOMS).onConflictDoNothing();
  await db.insert(productCategories).values(CATEGORIES.map((name) => ({ name }))).onConflictDoNothing();
  const [w1, w2] = await db.insert(warehouses).values([
    { code: "JAFZA", name: "Jebel Ali Free Zone Warehouse", address: "JAFZA South, Dubai", isDefault: true },
    { code: "ALQ", name: "Al Quoz Warehouse", address: "Al Quoz Industrial Area 3, Dubai" },
  ]).returning();
  const wh = { JAFZA: w1.id, ALQ: w2.id } as Record<string, string>;
  const us = await db.select().from(uoms), cs = await db.select().from(productCategories);
  const [admin] = await db.select().from(users).where(eq(users.email, "inventory@erp.local"));
  for (const p of PRODUCTS) {
    const [row] = await db.insert(products).values({
      sku: p.sku, name: p.name, categoryId: cs.find((c) => c.name === p.cat)!.id, baseUomId: us.find((u) => u.code === p.uom)!.id,
      tracking: p.tracking, reorderLevel: p.reorder, hsCode: p.hs,
    }).returning();
    if (p.packs.length) await db.insert(productPackagings).values(p.packs.map(([name, qty]) => ({ productId: row.id, name, qty })));
    for (const [w, qty, cost, lot, extra] of p.open as readonly (readonly unknown[])[]) {
      await db.transaction(async (tx) => {
        if (p.tracking === "serial") {
          for (const sn of lot as string[]) await postMove(tx, { productId: row.id, warehouseId: wh[w as string], type: "opening", qty: 1, unitCost: cost as string, lotNo: sn, note: "Opening stock" }, admin.id);
        } else {
          await postMove(tx, { productId: row.id, warehouseId: wh[w as string], type: "opening", qty: qty as string, unitCost: cost as string, lotNo: (lot as string) ?? null, expiryDate: (extra as string) ?? null, note: "Opening stock" }, admin.id);
        }
      });
    }
  }
}

const SUPPLIERS = [
  { code: "SUP-001", name: "Gujarat Agro Exports Pvt Ltd", country: "IN", contactName: "R. Patel", email: "export@gujaratagro.example", taxId: "24AAACG1234F1Z5", paymentTermsDays: 45 },
  { code: "SUP-002", name: "Shenzhen Brightway Electronics Co.", country: "CN", contactName: "Li Wei", email: "sales@brightway.example", paymentTermsDays: 30 },
  { code: "SUP-003", name: "Colombo Tea Traders", country: "LK", contactName: "S. Fernando", email: "orders@colombotea.example", paymentTermsDays: 60 },
];
const CUSTOMERS = [
  { code: "CUS-001", name: "Mombasa Fresh Foods Ltd", country: "KE", contactName: "J. Otieno", email: "buy@mombasafresh.example", creditDays: 45, creditLimit: "250000" },
  { code: "CUS-002", name: "Lagos Electronics Hub", country: "NG", contactName: "A. Okafor", email: "procure@lagoshub.example", creditDays: 30, creditLimit: "400000" },
  { code: "CUS-003", name: "Al Noor Trading LLC", country: "AE", contactName: "M. Al Noor", email: "accounts@alnoor.example", taxId: "100123456700003", creditDays: 30, creditLimit: "150000" },
];

async function seedContainers() {
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(suppliers);
  if (n > 0) return;
  await db.insert(suppliers).values(SUPPLIERS);
  await db.insert(customers).values(CUSTOMERS);
  const sup = Object.fromEntries((await db.select().from(suppliers)).map((x) => [x.code, x.id]));
  const cus = Object.fromEntries((await db.select().from(customers)).map((x) => [x.code, x.id]));
  const prod = Object.fromEntries((await db.select().from(products)).map((x) => [x.sku, x.id]));
  const [w1] = await db.select().from(warehouses).where(eq(warehouses.code, "JAFZA"));
  const [u] = await db.select().from(users).where(eq(users.email, "inventory@erp.local"));
  const actor = { id: u.id, email: u.email, role: { key: "inventory_manager" }, permissions: new Set() } as never;
  const meta = { ip: null, userAgent: null };
  let sn = 483200;
  const no = (p: string) => { const f = `${p}${String(sn++).padStart(6, "0")}`; return f + iso6346CheckDigit(f); };
  const day = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  const base = (over: Record<string, unknown>) => ({ sealNo: null, size: "40HC", shippingLine: "MSC", vessel: null, voyage: null, billOfLading: null, incoterm: "CIF", originCountry: null, loadPort: null, dischargePort: "Jebel Ali", warehouseId: w1.id, eta: null, customsDeclarationNo: null, freeZone: true, currency: "AED", exchangeRate: "1", notes: null, ...over });
  const item = (containerId: string, sku: string, qty: string, unitPrice: string, extra: Record<string, unknown> = {}) => ({ containerId, productId: prod[sku], qty, packagingId: null, unitPrice, lotNo: null, expiryDate: null, serials: [], weightKg: "0", volumeCbm: "0", ...extra });
  const cost = (containerId: string, type: string, amount: string, over: Record<string, unknown> = {}) => ({ containerId, type, description: null, payeeSupplierId: null, amount, currency: "AED", exchangeRate: "1", vat: "0", allocation: "value", inLandedCost: true, incurredOn: day(-10), ...over });
  const mk = (h: Record<string, unknown>) => containerSvc.createContainer(base(h) as never, actor, meta);
  const add = (i: Record<string, unknown>) => containerSvc.addItem(i as never, actor, meta);
  const addCost = (i: Record<string, unknown>) => containerSvc.addCost(i as never, actor, meta);
  const status = (id: string, to: string) => containerSvc.changeStatus(id, to, actor, meta);
  const serials = (p: string, n: number, start = 1) => Array.from({ length: n }, (_, i) => `${p}-${String(start + i).padStart(5, "0")}`);

  // ---- Inward ----
  const a = await mk({ direction: "inward", containerNo: no("MSCU"), partyId: sup["SUP-002"], billOfLading: "MSCUSZ2610441", loadPort: "Shenzhen (Yantian)", originCountry: "CN", currency: "USD", exchangeRate: "3.6725", eta: day(9), vessel: "MSC Aurora", voyage: "FA645R" });
  await add(item(a.id, "TV-LED55", "1", "310", { serials: serials("TV55", 20, 1001), weightKg: "6400", volumeCbm: "22" }));
  await add(item(a.id, "PHN-A15", "1", "170", { serials: serials("A15", 50, 20001), weightKg: "300", volumeCbm: "3" }));
  await addCost(cost(a.id, "freight", "2850", { currency: "USD", exchangeRate: "3.6725", allocation: "volume" }));
  await addCost(cost(a.id, "insurance", "420", { currency: "USD", exchangeRate: "3.6725", allocation: "value" }));

  const b = await mk({ direction: "inward", containerNo: no("MAEU"), partyId: sup["SUP-003"], billOfLading: "MAEUCMB778120", loadPort: "Colombo", originCountry: "LK", currency: "USD", exchangeRate: "3.6725", eta: day(2) });
  await add(item(b.id, "TEA-CTC", "1500", "2.6", { lotNo: "TEA-2611-A", expiryDate: day(540), weightKg: "10500", volumeCbm: "28" }));
  await addCost(cost(b.id, "freight", "1900", { currency: "USD", exchangeRate: "3.6725", allocation: "weight" }));
  await status(b.id, "at_port");

  const c = await mk({ direction: "inward", containerNo: no("CMAU"), partyId: sup["SUP-001"], billOfLading: "CMAUMUN551930", loadPort: "Mundra", originCountry: "IN", currency: "USD", exchangeRate: "3.6725", eta: day(-3), customsDeclarationNo: "DXB-2026-448812" });
  await add(item(c.id, "RICE-BAS", "800", "1.02", { weightKg: "20000", volumeCbm: "30" }));
  await add(item(c.id, "OIL-SUN-1L", "6000", "1.35", { lotNo: "OIL-2611-C", expiryDate: day(700), weightKg: "5800", volumeCbm: "9" }));
  await addCost(cost(c.id, "freight", "2300", { currency: "USD", exchangeRate: "3.6725", allocation: "weight" }));
  await addCost(cost(c.id, "customs_duty", "3120", { vat: "156", allocation: "value" }));
  await addCost(cost(c.id, "port_charges", "1450", { allocation: "volume" }));
  await status(c.id, "at_port"); await status(c.id, "cleared");

  const d = await mk({ direction: "inward", containerNo: no("TGHU"), partyId: sup["SUP-002"], billOfLading: "TGHUNGB330217", loadPort: "Ningbo", originCountry: "CN", currency: "USD", exchangeRate: "3.6725", eta: day(-20) });
  await add(item(d.id, "BAT-AA4", "12000", "0.95", { weightKg: "4200", volumeCbm: "26" }));
  await add(item(d.id, "FAB-COT", "6000", "1.7", { weightKg: "3100", volumeCbm: "18" }));
  await addCost(cost(d.id, "freight", "1750", { currency: "USD", exchangeRate: "3.6725", allocation: "weight" }));
  await addCost(cost(d.id, "customs_duty", "2650", { allocation: "value", vat: "132.5" }));
  await addCost(cost(d.id, "clearing", "900", { allocation: "quantity" }));
  await addCost(cost(d.id, "other", "600", { description: "Demurrage (3 days)", inLandedCost: false }));
  await status(d.id, "received");

  // ---- Outward ----
  const e = await mk({ direction: "outward", containerNo: no("OOLU"), partyId: cus["CUS-001"], billOfLading: "OOLUDXB9910", loadPort: "Jebel Ali", dischargePort: "Mombasa", originCountry: "KE", currency: "USD", exchangeRate: "3.6725", incoterm: "FOB", eta: day(21) });
  await add(item(e.id, "RICE-BAS", "5000", "1.18", { weightKg: "5000", volumeCbm: "8" }));
  await add(item(e.id, "OIL-SUN-1L", "1200", "1.6", { lotNo: "OIL-2406-A", weightKg: "1150", volumeCbm: "2" }));

  const f = await mk({ direction: "outward", containerNo: no("HLXU"), partyId: cus["CUS-002"], billOfLading: "HLXUDXB4472", loadPort: "Jebel Ali", dischargePort: "Lagos (Apapa)", originCountry: "NG", currency: "USD", exchangeRate: "3.6725", incoterm: "CFR" });
  await add(item(f.id, "PHN-A15", "1", "205", { serials: serials("A15", 8, 1) }));
  await addCost(cost(f.id, "freight", "2100", { currency: "USD", exchangeRate: "3.6725", allocation: "value", inLandedCost: false }));
  await addCost(cost(f.id, "transport", "650", { description: "Trucking to Jebel Ali" }));
  await status(f.id, "dispatched");

  const g = await mk({ direction: "outward", containerNo: no("ZIMU"), partyId: cus["CUS-003"], billOfLading: "ZIMUDXB1180", loadPort: "Jebel Ali", dischargePort: "Dubai (local)", originCountry: "AE" });
  await add(item(g.id, "BAT-AA4", "4000", "6.2"));
  await addCost(cost(g.id, "labour", "480", { description: "Loading labour" }));
  await status(g.id, "dispatched"); await status(g.id, "shipped"); await status(g.id, "delivered");
}

async function seedSales() {
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(salesT);
  await db.update(companySettings).set({
    name: "Al Safa Global Trading LLC", address: "Office 1204, Churchill Tower, Business Bay, Dubai, UAE", trn: "100345678900003",
    phone: "+971 4 555 0142", email: "accounts@alsafa-trading.example", bankName: "Emirates NBD", iban: "AE070331234567890123456",
    invoiceTerms: "Payment is due by the due date shown. Goods remain our property until paid in full. All disputes are subject to Dubai courts.",
  });
  if (n > 0) return;
  const [u] = await db.select().from(users).where(eq(users.email, "sales@erp.local"));
  const [ui] = await db.select().from(users).where(eq(users.email, "inventory@erp.local"));
  const sales = { id: u.id, email: u.email, role: { key: "sales_manager" }, permissions: new Set() } as never;
  const inv = { id: ui.id, email: ui.email, role: { key: "inventory_manager" }, permissions: new Set() } as never;
  const meta = { ip: null, userAgent: null };
  const cus = Object.fromEntries((await db.select().from(customers)).map((x) => [x.code, x.id]));
  const prod = Object.fromEntries((await db.select().from(products)).map((x) => [x.sku, x.id]));
  const byBl = async (bl: string) => (await db.select().from(containersT).where(eq(containersT.billOfLading, bl)))[0];
  const day = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  const lines = async (id: string) => db.select().from(saleLines).where(eq(saleLines.saleId, id));
  const draft = (saleId: string, ls: { id: string; qty: string }[], issueDate: string, fraction = 1) =>
    invSvc.createDraft({ saleId, lines: ls.map((l) => ({ saleLineId: l.id, qty: String(Math.floor(Number(l.qty) * fraction * 100) / 100) })), issueDate, supplyDate: issueDate, dueDate: null, notes: null }, inv, meta);
  const pay = (invoiceId: string, amount: string, date: string) => invSvc.recordPayment({ invoiceId, paymentDate: date, amount, method: "bank_transfer", reference: "TT" + Math.floor(Math.random() * 90000 + 10000), notes: null }, inv, meta);

  // 1) Delivered export to a UAE customer: billed in two parts, first part fully paid
  const c4 = await byBl("ZIMUDXB1180");
  const s1 = await salesSvc.createSale({ customerId: cus["CUS-003"], saleDate: day(-24), containerId: c4.id, currency: "AED", exchangeRate: "1", notes: "Local delivery" }, sales, meta);
  await salesSvc.importFromContainer(s1.id, sales, meta);
  const d1 = await invSvc.issueInvoice((await draft(s1.id, await lines(s1.id), day(-23), 0.6)).id, inv, meta);
  await pay(d1.id, d1.total, day(-10));
  await draft(s1.id, await lines(s1.id).then((ls) => ls.map((l) => ({ id: l.id, qty: String(Number(l.qty) * 0.4) }))), day(-1)); // second part left as a draft

  // 2) Dispatched export to Nigeria in USD (zero-rated): issued, partly paid
  const c3 = await byBl("HLXUDXB4472");
  const s2 = await salesSvc.createSale({ customerId: cus["CUS-002"], saleDate: day(-12), containerId: c3.id, currency: "USD", exchangeRate: "3.6725", notes: null }, sales, meta);
  await salesSvc.importFromContainer(s2.id, sales, meta);
  const d2 = await invSvc.issueInvoice((await draft(s2.id, await lines(s2.id), day(-11))).id, inv, meta);
  await pay(d2.id, "800", day(-4));

  // 3) Export still being packed: sale exists, nothing invoiced yet
  const c2 = await byBl("OOLUDXB9910");
  const s3 = await salesSvc.createSale({ customerId: cus["CUS-001"], saleDate: day(-2), containerId: c2.id, currency: "USD", exchangeRate: "3.6725", notes: null }, sales, meta);
  await salesSvc.importFromContainer(s3.id, sales, meta);

  // 4) Goods-only sale to a UAE customer, overdue
  const s4 = await salesSvc.createSale({ customerId: cus["CUS-003"], saleDate: day(-55), containerId: null, currency: "AED", exchangeRate: "1", notes: null }, sales, meta);
  await salesSvc.addLine({ saleId: s4.id, productId: prod["TILE-60"], description: "", qty: "20", unitPrice: "52", vatCategory: "standard", containerItemId: null }, sales, meta);
  await invSvc.issueInvoice((await draft(s4.id, await lines(s4.id), day(-54))).id, inv, meta);
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");
  const password = process.env.SEED_PASSWORD ?? "ChangeMe@123";

  for (const r of DEFAULT_ROLES) {
    const [existing] = await db.select().from(roles).where(eq(roles.key, r.key));
    if (existing) {
      // Dev convenience: add newly introduced permissions, never remove ones an admin changed.
      await db.insert(rolePermissions).values(r.permissions.map((permission) => ({ roleId: existing.id, permission }))).onConflictDoNothing();
      continue;
    }
    const [row] = await db.insert(roles).values({ key: r.key, name: r.name, description: r.description, isSystem: true }).returning();
    await db.insert(rolePermissions).values(r.permissions.map((permission) => ({ roleId: row.id, permission })));
  }

  await seedHr();
  await seedAttendance();
  const hash = await hashPassword(password);
  for (const u of USERS) {
    const [role] = await db.select().from(roles).where(eq(roles.key, u.role));
    await db.insert(users).values({ email: u.email, name: u.name, roleId: role.id, passwordHash: hash }).onConflictDoNothing();
  }
  await seedInventory();
  await seedContainers();
  await seedSales();
  const posted = await backfillLedger(null);
  console.log("Ledger postings created:", JSON.stringify(posted));
  console.log(`Seeded ${DEFAULT_ROLES.length} roles and ${USERS.length} users (password: ${password})`);
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
