import { z } from "zod";
import { AppError, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { todayISO } from "@/lib/dates";
import { balanceSheet, cashFlow, profitAndLoss, trialBalance, vatReturn } from "@/services/accounting/reports";
import { toCsv, toXlsx } from "@/services/sales/reports";

const q = z.object({
  report: z.enum(["tb", "pl", "bs", "cf", "vat"]).default("tb"), format: z.enum(["csv", "xlsx"]).default("csv"),
  from: z.iso.date().catch(todayISO().slice(0, 8) + "01"), to: z.iso.date().catch(todayISO()), asOf: z.iso.date().catch(todayISO()),
});
const f2 = (d: { toFixed(n: number): string }) => d.toFixed(2);

export const GET = route(["accounting:report:read"], async (req, { user }) => {
  const p = q.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!p.success) throw new AppError(422, "Invalid parameters");
  const { report, format, from, to, asOf } = p.data;
  let name: string, headers: string[], rows: (string | number | null)[][];
  if (report === "tb") {
    const t = await trialBalance(asOf); name = `trial-balance-${asOf}`; headers = ["Code", "Account", "Debit (AED)", "Credit (AED)"];
    rows = [...t.rows.map((r) => [r.code, r.name, f2(r.debit), f2(r.credit)]), ["", "Total", f2(t.debit), f2(t.credit)]];
  } else if (report === "pl") {
    const r = await profitAndLoss(from, to); name = `profit-and-loss-${from}-${to}`; headers = ["Section", "Code", "Account", "Amount (AED)"];
    rows = [...r.income.map((x) => ["Income", x.code, x.name, f2(x.amount)]), ["Income", "", "Total income", f2(r.totalIncome)], ...r.expenses.map((x) => ["Expense", x.code, x.name, f2(x.amount)]), ["Expense", "", "Total expenses", f2(r.totalExpenses)], ["", "", "Net profit", f2(r.netProfit)]];
  } else if (report === "bs") {
    const b = await balanceSheet(asOf); name = `balance-sheet-${asOf}`; headers = ["Section", "Code", "Account", "Amount (AED)"];
    rows = [...b.assets.map((x) => ["Assets", x.code, x.name, f2(x.amount)]), ["Assets", "", "Total assets", f2(b.totalAssets)], ...b.liabilities.map((x) => ["Liabilities", x.code, x.name, f2(x.amount)]), ["Liabilities", "", "Total liabilities", f2(b.totalLiabilities)],
      ...b.equity.map((x) => ["Equity", x.code, x.name, f2(x.amount)]), ["Equity", "", "Profit to date", f2(b.earnings)], ["Equity", "", "Total equity", f2(b.totalEquity)]];
  } else if (report === "cf") {
    const c = await cashFlow(from, to); name = `cash-flow-${from}-${to}`; headers = ["Source", "Cash in (AED)", "Cash out (AED)", "Net (AED)"];
    rows = [["Opening balance", "", "", f2(c.opening)], ...c.groups.map((g) => [g.label, f2(g.inflow), f2(g.outflow), f2(g.net)]), ["Closing balance", "", "", f2(c.closing)]];
  } else {
    const v = await vatReturn(from, to); name = `vat-summary-${from}-${to}`; headers = ["Description", "Amount (AED)", "VAT (AED)"];
    rows = [["Standard-rated supplies", f2(v.standard.net), f2(v.standard.vat)], ["Zero-rated supplies", f2(v.zero.net), ""], ["Exempt supplies", f2(v.exempt.net), ""], ["Out of scope", f2(v.outOfScope.net), ""], ["Total output VAT", "", f2(v.outputVat)], ["Input VAT recoverable", "", f2(v.inputVat)], ["Net VAT payable (refundable if negative)", "", f2(v.netPayable)]];
  }
  await audit({ action: "export_report", entity: "report", entityId: name, after: { format }, userId: user.id, userEmail: user.email });
  if (format === "xlsx") return new Response(new Uint8Array(await toXlsx(name, headers, rows, headers.length > 3 && report !== "cf" ? 3 : 1)), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"`, "Cache-Control": "private, no-store" } });
  return new Response(toCsv(headers, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
});
