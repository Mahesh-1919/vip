import { z } from "zod";
import { AppError, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { formatSheetDate } from "@/lib/dates";
import { listEntries, listExits } from "@/services/freezone";

const q = z.object({
  sheet: z.enum(["entries", "exits"]), q: z.string().max(80).optional(), from: z.iso.date().optional().catch(undefined), to: z.iso.date().optional().catch(undefined),
  agent: z.string().max(120).optional(), origin: z.string().max(40).optional(), type: z.string().max(10).optional(), cert: z.string().max(20).optional(), refund: z.string().max(20).optional(),
});

/** Reads every page of a filtered list (100 per page). */
async function all<T>(fetch: (page: number) => Promise<{ rows: T[]; pages: number }>) {
  const first = await fetch(1);
  const rest = await Promise.all(Array.from({ length: first.pages - 1 }, (_, i) => fetch(i + 2)));
  return [...first.rows, ...rest.flatMap((r) => r.rows)];
}

export const GET = route([], async (req, { user }) => {
  const p = q.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!p.success) throw new AppError(422, "Invalid parameters");
  const f = p.data;
  if (!user.permissions.has(f.sheet === "entries" ? "freezone:entry:read" : "freezone:exit:read")) throw new AppError(403, "Forbidden");
  let headers: string[], rows: (string | number | null)[][], name: string;
  if (f.sheet === "entries") {
    const data = await all((page) => listEntries({ ...f, page, size: 100 }));
    headers = ["Sl", "Bill Date", "Bill No", "Agent Name", "Transfer No", "Arrival Date", "Port of Loading", "Port of Discharge", "Invoice No", "Value (AED)", "Weight (Kg)", "No of Packages", "Stock", "Marks & Numbers", "Line"];
    rows = data.map(({ e, sl }) => [sl, formatSheetDate(e.billDate), e.billNo, e.agentName, e.transferNo, formatSheetDate(e.arrivalDate), e.portOfLoading, e.portOfDischarge, e.invoiceNo, e.valueAed, e.weightKg, e.packages, e.originCountry, e.marksNumbers, e.line]);
    name = "entry-bills";
  } else {
    const data = await all((page) => listExits({ ...f, page, size: 100 }));
    headers = ["Sl", "Date", "BOE No", "Importer Name", "Ref No", "Bill Type", "Port of Loading", "Port of Discharge", "Invoice No", "Value (AED)", "Weight (Kg)", "No of Packages", "Country", "Truck / Container No", "T/Entry Cert", "Cheque Date", "Cheque Amount", "Refund Status", "Shipping"];
    rows = data.map(({ e, sl }) => [sl, formatSheetDate(e.exitDate), e.boeNo, e.importerName, e.refNo, e.billType, e.portOfLoading, e.portOfDischarge, e.invoiceNo, e.valueAed, e.weightKg, e.packages, e.country, e.truckContainerNo, e.entryCertStatus, formatSheetDate(e.chequeDate), e.chequeAmount, e.refundStatus, e.shippingLine]);
    name = "exit-bills";
  }
  await audit({ action: "export", entity: f.sheet === "entries" ? "entry_bill" : "exit_bill", entityId: name, after: { rows: rows.length }, userId: user.id, userEmail: user.email });
  return new Response(toCsv(headers, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
});
