/* Idempotent seed for the POC. Run: npm run db:seed   (DEV ONLY demo data: all names and numbers are fictional) */
import { eq, sql as dsql } from "drizzle-orm";
import { db, sql } from "./index";
import { roles, rolePermissions, users, departments, salaryComponents, employees, employeeSalaries, employeeSalaryLines } from "./schema";
import { shifts, shiftAssignments, holidayCalendars, holidays, leaveTypes, leaveBalances, leaveRequests, attendance } from "./schema";
import { entryBills, exitBills, customers, companySettings, saleLines } from "./schema";
import * as billing from "../services/billing";
import * as freezoneSvc from "../services/freezone";
import * as exitBilling from "../services/exit-billing";
import { billAllocations } from "./schema";
import { asc } from "drizzle-orm";
import { encryptField } from "../lib/crypto";
import { DEFAULT_ROLES } from "../lib/rbac";
import { hashPassword } from "../lib/password";

const USERS: { email: string; name: string; role: string; password?: string }[] = [
  { email: "sales@erp.local", name: "Sara Sales", role: "sales_manager" },
  { email: "admin@vip.com", name: "Admin", role: "admin", password: "admin" },
  { email: "hr@erp.local", name: "Hana HR", role: "hr_manager" },
  { email: "operations@erp.local", name: "Omar Operations", role: "operations_manager" },
];

const day = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

const DEPTS = ["Operations", "Warehouse & Loading", "Transport", "Clearing & Documentation", "Accounts", "HR & Admin"];
const COMPONENTS = [
  { code: "HOUSING", name: "Housing allowance", type: "allowance", calc: "percent_of_basic", defaultValue: "25.00" },
  { code: "TRANSPORT", name: "Transport allowance", type: "allowance", calc: "fixed", defaultValue: "300.00" },
  { code: "PHONE", name: "Phone allowance", type: "allowance", calc: "fixed", defaultValue: "100.00" },
  { code: "ADVANCE", name: "Salary advance recovery", type: "deduction", calc: "fixed", defaultValue: "0.00" },
  { code: "FINE", name: "Fines / penalties", type: "deduction", calc: "fixed", defaultValue: "0.00" },
] as const;

// Fictional staff. Passport/visa dates are offsets in days from today so the demo always shows expired and expiring documents.
const STAFF: { id: string; name: string; passport: string; ppIssue: number; ppExpiry: number; visaIssue: number; visaExpiry: number; desig: string; dept: string; nat: string; join: string; basic: string; gender?: string }[] = [
  { id: "20431001", name: "Karim Haddad", passport: "EP 4410021", ppIssue: -900, ppExpiry: 920, visaIssue: -300, visaExpiry: 430, desig: "Labourer", dept: "Warehouse & Loading", nat: "Egypt", join: "2023-02-01", basic: "1400" },
  { id: "20431002", name: "Samuel Tesfaye Bekele", passport: "EQ 7720184", ppIssue: -400, ppExpiry: 1400, visaIssue: -200, visaExpiry: 520, desig: "Labourer", dept: "Warehouse & Loading", nat: "Ethiopia", join: "2024-01-15", basic: "1300" },
  { id: "20431003", name: "Mohammed Yusuf Rahman", passport: "BX 3301998", ppIssue: -1600, ppExpiry: 210, visaIssue: -500, visaExpiry: 230, desig: "Loader", dept: "Warehouse & Loading", nat: "Bangladesh", join: "2022-06-10", basic: "1500" },
  { id: "20431004", name: "Daniel Okoro", passport: "A 5523310", ppIssue: -2000, ppExpiry: -15, visaIssue: -700, visaExpiry: 25, desig: "Labourer", dept: "Warehouse & Loading", nat: "Nigeria", join: "2021-09-01", basic: "1400" },
  { id: "20431005", name: "Imran Khalid Shah", passport: "AB 9981204", ppIssue: -800, ppExpiry: 1000, visaIssue: -400, visaExpiry: -12, desig: "Driver", dept: "Transport", nat: "Pakistan", join: "2022-03-20", basic: "2200" },
  { id: "20431006", name: "Rashid Mehmood Qureshi", passport: "CT 1189077", ppIssue: -300, ppExpiry: 1500, visaIssue: -250, visaExpiry: 480, desig: "Driver", dept: "Transport", nat: "Pakistan", join: "2023-07-05", basic: "2200" },
  { id: "20431007", name: "Joseph Mwangi Kamau", passport: "AK 2276431", ppIssue: -1200, ppExpiry: 2400, visaIssue: -330, visaExpiry: 400, desig: "General Helper", dept: "Operations", nat: "Kenya", join: "2024-05-12", basic: "1200" },
  { id: "20431008", name: "Anil Kumar Nair", passport: "N 7745120", ppIssue: -500, ppExpiry: 3100, visaIssue: -120, visaExpiry: 610, desig: "Warehouse Supervisor", dept: "Warehouse & Loading", nat: "India", join: "2021-01-10", basic: "3800" },
  { id: "20431009", name: "Hassan Ali Mirza", passport: "PK 6612903", ppIssue: -700, ppExpiry: 80, visaIssue: -600, visaExpiry: 95, desig: "Labourer", dept: "Warehouse & Loading", nat: "Pakistan", join: "2022-11-02", basic: "1350" },
  { id: "20431010", name: "Peter Ndlovu", passport: "FN 3340871", ppIssue: -250, ppExpiry: 1700, visaIssue: -180, visaExpiry: 560, desig: "Labourer", dept: "Operations", nat: "Zimbabwe", join: "2024-08-19", basic: "1300" },
  { id: "20431011", name: "Sara Al Hammadi", passport: "AE 4410992", ppIssue: -600, ppExpiry: 1200, visaIssue: -300, visaExpiry: 700, desig: "Accountant", dept: "Accounts", nat: "UAE", join: "2020-09-15", basic: "7500", gender: "female" },
  { id: "20431012", name: "Vikram Singh Rathore", passport: "Z 1109834", ppIssue: -900, ppExpiry: 900, visaIssue: -400, visaExpiry: 350, desig: "Documentation Clerk", dept: "Clearing & Documentation", nat: "India", join: "2022-04-04", basic: "3200" },
  { id: "20431013", name: "Nadia Farouk", passport: "A 20815567", ppIssue: -450, ppExpiry: 1300, visaIssue: -210, visaExpiry: 640, desig: "HR Officer", dept: "HR & Admin", nat: "Egypt", join: "2022-07-01", basic: "5200", gender: "female" },
  { id: "20431014", name: "Tariq Mahmood Bhatti", passport: "GH 7745601", ppIssue: -1000, ppExpiry: 650, visaIssue: -420, visaExpiry: 300, desig: "Operations Manager", dept: "Operations", nat: "Pakistan", join: "2019-02-18", basic: "8500" },
];

async function seedHr() {
  await db.insert(departments).values(DEPTS.map((name) => ({ name }))).onConflictDoNothing();
  await db.insert(salaryComponents).values([...COMPONENTS]).onConflictDoNothing();
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(employees);
  if (n > 0) return;
  const depts = await db.select().from(departments);
  const comps = await db.select().from(salaryComponents);
  for (const e of STAFF) {
    await db.transaction(async (tx) => {
      const [row] = await tx.insert(employees).values({
        empCode: e.id, name: e.name, nationality: e.nat, gender: e.gender ?? "male", joinDate: e.join, designation: e.desig,
        departmentId: depts.find((d) => d.name === e.dept)?.id, passportNoEnc: encryptField(e.passport.replace(/\s/g, "")),
        passportIssueDate: day(e.ppIssue), passportExpiry: day(e.ppExpiry), visaIssueDate: day(e.visaIssue), visaExpiry: day(e.visaExpiry),
        phone: "+971 50 123 4567",
      }).returning();
      const [sal] = await tx.insert(employeeSalaries).values({ employeeId: row.id, effectiveFrom: e.join, basic: e.basic }).returning();
      const lines = [["HOUSING", Number(e.basic) > 3000 ? "25" : "15"], ["TRANSPORT", Number(e.basic) > 3000 ? "400" : "250"]].map(([code, value]) => ({ salaryId: sal.id, componentId: comps.find((c) => c.code === code)!.id, value }));
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
    employeeId: e.id, shiftId: e.designation === "Warehouse Supervisor" || e.designation === "Loader" ? warehouse.id : general.id, effectiveFrom: e.joinDate,
  })));

  // 30 days of attendance (deterministic pseudo-random)
  const rand = rng(42);
  const holidaySet = new Set(fixed.map(([d]) => d));
  const rows: (typeof attendance.$inferInsert)[] = [];
  for (let back = 30; back >= 1; back--) {
    const date = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
    const wd = new Date(date + "T00:00:00Z").getUTCDay();
    for (const e of emps) {
      const off = e.designation === "Warehouse Supervisor" || e.designation === "Loader" ? [0] : [0, 6];
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
  const omar = emps.find((e) => e.designation === "HR Officer")!, fatima = emps.find((e) => e.designation === "Accountant")!;
  const plus = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  await db.insert(leaveRequests).values({ employeeId: omar.id, leaveTypeId: t("ANNUAL").id, fromDate: plus(14), toDate: plus(14), days: "1", reason: "Family event" });
  const year = new Date().getUTCFullYear();
  await db.insert(leaveBalances).values({ employeeId: fatima.id, leaveTypeId: t("SICK").id, year, allocated: "90", used: "2" }).onConflictDoNothing();
}


// ---------------- Free zone register (fictional data in the layout of the real sheets) ----------------
const AGENTS = ["Alpha Transit Freight L.L.C", "Gulf Shipping Commission", "Sama Cargo and Transport", "Delta Logistics FZE", "Horizon Customs Clearing"];
const LOADING = [["Muscat", "Hatta Customs", "OMAN", "CN"], ["Riyadh", "Abu Dhabi", "SAUDI", "CN"], ["Bahrain", "Jebel Ali Port", "BAHRAIN", "BH"], ["Piraeus", "Jebel Ali Port", "GREECE", "GR"], ["Port Said", "Jebel Ali Port", "EGYPT", "TR"], ["Avcilar", "Jebel Ali Port", "TURKEY", "TR"], ["Hamriyah Freezone", "Saif Zone", "HAMRIYA", "GB"], ["Frankfurt am Main", "Dubai Airport FZ", "EUROPE", "CN"]];
const DEST = [["Dar es Salaam", "TZ"], ["Mombasa", "KE"], ["Dakar", "SN"], ["Aqaba", "JO"], ["Luanda", "AO"], ["Pointe Noire", "CG"], ["Abidjan", "CI"], ["Matadi", "CD"]];
const IMPORTERS = ["Delta Trading Co", "Horizon General Trading", "Nile Import Export", "Savanna Traders", "Atlas Commodities Ltd", "Bluewave Enterprises", "Coastline Merchants"];

const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
const cont = (r: () => number) => `${["MSKU", "HLXU", "TGHU", "CAIU", "MRKU", "TCNU"][Math.floor(r() * 6)]}${String(Math.floor(r() * 9_000_000 + 1_000_000))}`;

async function seedFreeZone() {
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(entryBills);
  if (n > 0) return;
  const r = rng(11);
  const entries = Array.from({ length: 26 }, (_, i) => {
    const [pol, pod, line, origin] = pick(r, LOADING) as string[];
    const containers = Array.from({ length: 1 + Math.floor(r() * 3) }, () => cont(r));
    const d = -(60 - i * 2);
    return {
      billDate: day(d), billNo: `1-3-60-8-26-${String(4300 + i * 7).padStart(4, "0")}`, agentName: pick(r, AGENTS), transferNo: String(Math.floor(r() * 9e11 + 1e11)),
      arrivalDate: day(d - 1 - Math.floor(r() * 3)), portOfLoading: pol, portOfDischarge: pod, invoiceNo: `INV-${Math.floor(r() * 90000 + 10000)}`,
      valueAed: (r() * 90000 + 4000).toFixed(2), weightKg: (Math.floor(r() * 36) * 1000 + 4000).toFixed(2), packages: Math.floor(r() * 700) + 1,
      originCountry: origin, marksNumbers: containers.join(", "), line,
    };
  });
  await db.insert(entryBills).values(entries);

  const exits = Array.from({ length: 22 }, (_, i) => {
    const [dest, country] = pick(r, DEST) as string[];
    const exportBill = r() > 0.15;
    const received = r() > 0.25;
    const d = -(55 - i * 2.4);
    const cheque = Math.floor(r() * 35 + 12) * 100;
    return {
      exitDate: day(Math.round(d)), boeNo: `1-3-60-1-26-${String(900 + i * 11).padStart(4, "0")}`, importerName: pick(r, IMPORTERS), refNo: `2026-FZ${String(4000 + i * 13).padStart(6, "0")}`,
      billType: exportBill ? "EXPORT" : "IMPORT", portOfLoading: exportBill ? "Jebel Ali Port" : "Saif Zone", portOfDischarge: exportBill ? dest : "Sharjah City",
      invoiceNo: `SO${Math.floor(r() * 9000 + 25000)}`, valueAed: (r() * 80000 + 20000).toFixed(2), weightKg: (Math.floor(r() * 12) * 1000 + 14000).toFixed(2), packages: exportBill ? Math.floor(r() * 700) + 100 : 1,
      country: country, truckContainerNo: Array.from({ length: 1 + Math.floor(r() * 2) }, () => cont(r)).join(", "),
      entryCertStatus: exportBill ? (received ? "Received" : "Pending") : "No Need", chequeDate: exportBill ? day(Math.round(d) + 120) : null, chequeAmount: exportBill ? String(cheque) : null,
      refundStatus: exportBill ? (received ? "Refund Received" : "Pending") : "No Need", shippingLine: pick(r, ["AL", "MSC", "MAERSK", "CMA"]),
    };
  });
  await db.insert(exitBills).values(exits);
}

async function seedSales() {
  await db.update(companySettings).set({
    name: "Al Safa Global Trading LLC", address: "Office 1204, Business Bay, Dubai, UAE", trn: "100345678900003", phone: "+971 4 555 0142", email: "accounts@alsafa-trading.example",
    bankName: "Emirates NBD", iban: "AE070331234567890123456", invoiceTerms: "Payment is due by the due date shown. Goods remain our property until paid in full.",
  });
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(customers);
  if (n > 0) return;
  await db.insert(customers).values([
    { name: "Delta Trading Co", contactName: "A. Rahman", phone: "+971 50 111 2233", email: "accounts@delta-trading.example", trn: "100456789000003", creditDays: 30, address: "Al Quoz, Dubai" },
    { name: "Horizon General Trading", contactName: "M. Farouk", phone: "+971 55 222 3344", email: "finance@horizon-gt.example", trn: "100567890100003", creditDays: 45, address: "Sharjah Airport Free Zone" },
    { name: "Nile Import Export", contactName: "S. Mansour", phone: "+971 52 333 4455", email: "ops@nile-ie.example", creditDays: 30, address: "Deira, Dubai" },
    { name: "Savanna Traders", contactName: "J. Kimani", phone: "+971 54 444 5566", email: "billing@savanna.example", creditDays: 15, address: "Hamriyah Free Zone, Sharjah" },
  ]);
  const cus = await db.select().from(customers);
  const [u] = await db.select().from(users).where(eq(users.email, "sales@erp.local"));
  const actor = { id: u.id, email: u.email, role: { key: "sales_manager" }, permissions: new Set() } as never;
  const meta = { ip: null, userAgent: null };
  const c = (name: string) => cus.find((x) => x.name === name)!.id;
  const mk = async (customer: string, ago: number, billRef: string | null, lines: [string, string, string, string][]) => {
    const id = await billing.saveSale(null, { customerId: c(customer), saleDate: day(-ago), billRef, notes: null, lines: lines.map(([description, qty, unitPrice, vatRate]) => ({ description, qty, unitPrice, vatRate })) }, undefined, actor, meta);
    return id;
  };
  const invoice = async (saleId: string, ago: number) => billing.createInvoice({ saleId, issueDate: day(-ago), dueDate: null, notes: null }, actor, meta);
  const pay = (invoiceId: string, amount: string, ago: number) => billing.recordPayment({ invoiceId, paymentDate: day(-ago), amount, method: "bank_transfer", reference: "TT" + Math.floor(Math.random() * 90000 + 10000) }, actor, meta);

  const s1 = await mk("Delta Trading Co", 70, "1-3-60-1-26-911", [["Clearing & handling charges", "1", "1850.00", "5"], ["Documentation fee", "1", "350.00", "5"]]);
  const i1 = await invoice(s1, 69); await pay(i1.id, i1.total, 40);
  const s2 = await mk("Horizon General Trading", 48, "1-3-60-1-26-934", [["Export clearing: 40ft container", "2", "1200.00", "0"], ["Transport to Jebel Ali", "2", "650.00", "5"]]);
  const i2 = await invoice(s2, 47); await pay(i2.id, "1500.00", 20);
  const s3 = await mk("Nile Import Export", 40, null, [["Storage charges (30 days)", "1", "2400.00", "5"]]);
  await invoice(s3, 39);
  const s4 = await mk("Savanna Traders", 12, "1-3-60-8-26-4390", [["Entry bill processing", "3", "420.00", "5"], ["Loading / unloading labour", "6", "180.00", "5"]]);
  const i4 = await invoice(s4, 11); await pay(i4.id, "500.00", 3);
  await mk("Delta Trading Co", 3, "1-3-60-1-26-958", [["Clearing & handling charges", "1", "1850.00", "5"]]);
  await mk("Horizon General Trading", 1, null, [["Documentation fee", "2", "350.00", "5"], ["Courier", "1", "120.00", "5"]]);
  void saleLines;
}

async function seedLinks() {
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(billAllocations);
  if (n > 0) return;
  // 1) Link each exit's importer name to a customer (creating the ones the sheets mention).
  const existing = await db.select().from(customers);
  const names = [...new Set((await db.select({ n: exitBills.importerName }).from(exitBills)).map((r) => r.n).filter((x): x is string => !!x))];
  for (const name of names) if (!existing.find((c) => c.name === name)) await db.insert(customers).values({ name, creditDays: 30, address: "Africa" });
  const cus = await db.select().from(customers);
  for (const c of cus) await db.update(exitBills).set({ customerId: c.id }).where(eq(exitBills.importerName, c.name));

  // 2) Trace exits back to entries, oldest stock first. Some exits stay unlinked on purpose (the "unlinked" queue).
  const [op] = await db.select().from(users).where(eq(users.email, "operations@erp.local"));
  const ops = { id: op.id, email: op.email, role: { key: "operations_manager" }, permissions: new Set() } as never;
  const meta = { ip: null, userAgent: null };
  const entries = await db.select().from(entryBills).orderBy(asc(entryBills.billDate));
  const left = new Map(entries.map((e) => [e.id, e.packages]));
  const exits = await db.select().from(exitBills).orderBy(asc(exitBills.exitDate));
  let k = 0;
  for (const x of exits) {
    if (++k % 5 === 0 || x.packages <= 1) continue;
    let need = x.packages;
    for (const e of entries) {
      const have = left.get(e.id) ?? 0;
      if (need <= 0) break;
      if (have <= 0 || e.billDate > x.exitDate) continue;
      const take = Math.min(have, need);
      await freezoneSvc.allocate({ exitBillId: x.id, entryBillId: e.id, packages: take, weightKg: "0" }, ops, meta);
      left.set(e.id, have - take); need -= take;
    }
  }

  // 3) A few invoices from export bills: one in full, one in two parts, one consolidated for a customer.
  const [sm] = await db.select().from(users).where(eq(users.email, "sales@erp.local"));
  const sales = { id: sm.id, email: sm.email, role: { key: "sales_manager" }, permissions: new Set() } as never;
  // Only fully linked export bills can be invoiced (stock rule).
  const linked = new Map<string, number>();
  for (const a of await db.select().from(billAllocations)) linked.set(a.exitBillId, (linked.get(a.exitBillId) ?? 0) + a.packages);
  const exportsByCustomer = new Map<string, (typeof exits)[number][]>();
  for (const x of exits) if (x.billType === "EXPORT" && x.customerId && x.packages > 0 && (linked.get(x.id) ?? 0) >= x.packages) exportsByCustomer.set(x.customerId, [...(exportsByCustomer.get(x.customerId) ?? []), x]);
  const groups = [...exportsByCustomer.entries()].filter(([, v]) => v.length > 0);
  const day = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  if (groups[0]) { const [cid, xs] = groups[0]; await exitBilling.createExitInvoice({ customerId: cid, issueDate: day(-25), dueDate: null, notes: null, lines: [{ exitBillId: xs[0].id, packages: xs[0].packages }] }, sales, meta); }
  if (groups[1]) { const [cid, xs] = groups[1]; const x = xs[0]; const part = Math.max(1, Math.floor(x.packages * 0.4));
    const inv = await exitBilling.createExitInvoice({ customerId: cid, issueDate: day(-18), dueDate: null, notes: "Part 1 of 2", lines: [{ exitBillId: x.id, packages: part }] }, sales, meta);
    await billing.recordPayment({ invoiceId: inv.id, paymentDate: day(-6), amount: inv.total, method: "bank_transfer", reference: "TT" + Math.floor(Math.random() * 90000 + 10000) }, sales, meta); }
  if (groups[2] && groups[2][1].length > 1) { const [cid, xs] = groups[2]; await exitBilling.createExitInvoice({ customerId: cid, issueDate: day(-9), dueDate: null, notes: "Consolidated", lines: xs.slice(0, 2).map((x) => ({ exitBillId: x.id, packages: x.packages })) }, sales, meta); }
}

export async function seedDemo() {
  if (process.env.NODE_ENV === "production" && process.env.DATA_MODE === "db") throw new Error("Refusing to seed demo data into a production database");
  const password = process.env.SEED_PASSWORD ?? "ChangeMe@123";

  for (const r of DEFAULT_ROLES) {
    const [existing] = await db.select().from(roles).where(eq(roles.key, r.key));
    if (existing) {
      await db.insert(rolePermissions).values(r.permissions.map((permission) => ({ roleId: existing.id, permission }))).onConflictDoNothing();
      continue;
    }
    const [row] = await db.insert(roles).values({ key: r.key, name: r.name, description: r.description, isSystem: true }).returning();
    await db.insert(rolePermissions).values(r.permissions.map((permission) => ({ roleId: row.id, permission })));
  }

  const hash = await hashPassword(password);
  for (const u of USERS) {
    const passwordHash = u.password ? await hashPassword(u.password) : hash;
    const [role] = await db.select().from(roles).where(eq(roles.key, u.role));
    await db.insert(users).values({ email: u.email, name: u.name, roleId: role.id, passwordHash }).onConflictDoNothing();
  }
  await seedHr();
  await seedAttendance();
  await seedFreeZone();
  await seedSales();
  await seedLinks();
  console.log(`Seeded ${DEFAULT_ROLES.length} roles and ${USERS.length} users (password: ${password})`);
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seedDemo().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
}
