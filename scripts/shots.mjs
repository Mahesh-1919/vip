// Dev helper: logs in and screenshots key pages. Usage: node scripts/shots.mjs <outDir> [desktop|mobile] [light|dark] [email]
import { chromium } from "playwright";
const [out = "shots", mode = "desktop", scheme = "light", email = "admin@erp.local"] = process.argv.slice(2);
const base = process.env.BASE ?? "http://localhost:3000";
const pages = (process.env.PAGES ?? "/,/hr/employees,/freezone/entries,/freezone/exits,/freezone/trace,/sales/invoices,/sales/invoices/new,/sales,/hr/attendance,/hr/payroll").split(",");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: mode === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 900 }, colorScheme: scheme });
const page = await ctx.newPage();
await page.goto(base + "/login", { waitUntil: "networkidle" });
await page.screenshot({ path: `${out}/login-${mode}-${scheme}.png` });
await page.fill("input[name=email]", email);
await page.fill("input[name=password]", "ChangeMe@123");
await Promise.all([page.waitForURL(base + "/", { timeout: 20000 }), page.click("button[type=submit]")]);
for (const p of pages) {
  await page.goto(base + p, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const name = (p === "/" ? "home" : p.slice(1).replace(/[\/?=&]/g, "_"));
  await page.screenshot({ path: `${out}/${name}-${mode}-${scheme}.png`, fullPage: !!process.env.FULL });
}
await browser.close();
