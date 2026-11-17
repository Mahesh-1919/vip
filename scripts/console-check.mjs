// Dev helper: visits pages as a role and prints console errors/warnings and failed requests.
import { chromium } from "playwright";
const [email = "admin@erp.local"] = process.argv.slice(2);
const base = process.env.BASE ?? "http://localhost:3000";
const pages = (process.env.PAGES ?? "/,/hr/employees,/hr/employees/new,/hr/attendance,/hr/leave,/hr/payroll,/hr/shifts,/freezone/entries,/freezone/entries/new,/freezone/exits,/freezone/exits/new,/freezone/trace,/sales,/sales/new,/sales/invoices,/sales/invoices/new,/sales/customers,/admin/users,/admin/audit-log,/admin/settings").split(",");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
let current = "";
const seen = new Set();
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) { const k = current + "|" + m.text().slice(0, 160); if (!seen.has(k)) { seen.add(k); console.log(`[${m.type()}] ${current}\n   ${m.text().slice(0, 400).replace(/\n/g, "\n   ")}`); } } });
page.on("pageerror", (e) => console.log(`[pageerror] ${current}: ${e.message.slice(0, 300)}`));
page.on("response", (r) => { if (r.status() >= 400) console.log(`[http ${r.status()}] ${current}: ${r.url().replace(base, "")}`); });
await page.goto(base + "/login", { waitUntil: "networkidle" });
await page.fill("input[name=email]", email); await page.fill("input[name=password]", "ChangeMe@123");
await Promise.all([page.waitForURL(base + "/", { timeout: 20000 }), page.click("button[type=submit]")]);
for (const p of pages) { current = p; await page.goto(base + p, { waitUntil: "networkidle" }); await page.waitForTimeout(300); }
console.log("checked", pages.length, "pages");
await browser.close();
