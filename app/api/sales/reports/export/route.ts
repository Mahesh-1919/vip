import { z } from "zod";
import { AppError, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { containerPnl, salesReport, toCsv, toXlsx, type GroupBy } from "@/services/sales/reports";

const q = z.object({
  report: z.enum(["period", "customer", "product", "container", "pnl"]).default("period"),
  format: z.enum(["csv", "xlsx"]).default("csv"),
  granularity: z.enum(["day", "month", "year"]).default("month"),
  from: z.iso.date().optional().catch(undefined), to: z.iso.date().optional().catch(undefined),
  customerId: z.uuid().optional().catch(undefined), productId: z.uuid().optional().catch(undefined), containerId: z.uuid().optional().catch(undefined),
});

export const GET = route(["sales:report:read"], async (req, { user }) => {
  const parsed = q.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) throw new AppError(422, "Invalid export parameters");
  const f = parsed.data;
  let headers: string[], rows: (string | number | null)[][], name: string;
  if (f.report === "pnl") {
    const data = await containerPnl({ from: f.from, to: f.to });
    headers = ["Ref", "Container", "Direction", "Status", "Party", "Revenue (AED)", "Goods cost (AED)", "Other costs (AED)", "Profit (AED)", "Margin %"];
    rows = data.map((r) => [r.ref, r.containerNo, r.direction, r.status, r.party, r.revenueAed, r.goodsCostAed, r.otherCostsAed, r.costOnly ? null : r.profitAed, r.marginPct]);
    name = "container-pnl";
  } else {
    const data = await salesReport({ groupBy: f.report as GroupBy, granularity: f.granularity, from: f.from, to: f.to, customerId: f.customerId, productId: f.productId, containerId: f.containerId });
    const label = { period: "Period", customer: "Customer", product: "Product", container: "Container" }[f.report];
    headers = [label, "Sales", "Quantity", "Revenue excl. VAT (AED)", "VAT (AED)"];
    rows = data.map((r) => [r.label, r.sales, r.qty, r.revenueAed, r.vatAed]);
    name = `sales-by-${f.report}`;
  }
  await audit({ action: "export_report", entity: "report", entityId: name, after: { format: f.format, rows: rows.length }, userId: user.id, userEmail: user.email });
  const stamp = new Date().toISOString().slice(0, 10);
  if (f.format === "xlsx") {
    const buf = await toXlsx(name, headers, rows, f.report === "pnl" ? 5 : 1);
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}-${stamp}.xlsx"`, "Cache-Control": "private, no-store" } });
  }
  return new Response(toCsv(headers, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-${stamp}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
});
