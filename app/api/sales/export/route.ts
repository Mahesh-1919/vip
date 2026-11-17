import { z } from "zod";
import { AppError, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { formatSheetDate } from "@/lib/dates";
import { stateOf, listInvoices, listSales } from "@/services/billing";

const uuid = z.uuid().optional().catch(undefined);
const q = z.object({ sheet: z.enum(["sales", "invoices"]), q: z.string().max(80).optional(), customerId: uuid, from: z.iso.date().optional().catch(undefined), to: z.iso.date().optional().catch(undefined), invoiced: z.string().max(3).optional(), status: z.string().max(10).optional() });

async function all<T>(fetch: (page: number) => Promise<{ rows: T[]; pages: number }>) {
  const first = await fetch(1);
  const rest = await Promise.all(Array.from({ length: first.pages - 1 }, (_, i) => fetch(i + 2)));
  return [...first.rows, ...rest.flatMap((r) => r.rows)];
}

export const GET = route([], async (req, { user }) => {
  const p = q.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!p.success) throw new AppError(422, "Invalid parameters");
  const f = p.data;
  if (!user.permissions.has(f.sheet === "sales" ? "sales:sale:read" : "sales:invoice:read")) throw new AppError(403, "Forbidden");
  let headers: string[], rows: (string | number | null)[][];
  if (f.sheet === "sales") {
    const data = await all((page) => listSales({ ...f, page, size: 100 }));
    headers = ["Ref", "Date", "Customer", "Bill ref", "Net (AED)", "Total incl. VAT (AED)", "Invoice"];
    rows = data.map((r) => [r.s.ref, formatSheetDate(r.s.saleDate), r.customer, r.s.billRef, r.net, r.total, r.invoiceNo]);
  } else {
    const data = await all((page) => listInvoices({ ...f, page, size: 100 }));
    headers = ["Invoice", "Date", "Customer", "Sale", "Due", "Total (AED)", "Paid (AED)", "Status"];
    rows = data.map((r) => [r.inv.number, formatSheetDate(r.inv.issueDate), r.customer, r.saleRef, formatSheetDate(r.inv.dueDate), r.inv.total, r.inv.paidAmount, stateOf(r.inv)]);
  }
  await audit({ action: "export", entity: f.sheet === "sales" ? "sale" : "invoice", entityId: f.sheet, after: { rows: rows.length }, userId: user.id, userEmail: user.email });
  return new Response(toCsv(headers, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${f.sheet}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
});
