import { renderToBuffer } from "@react-pdf/renderer";
import { z } from "zod";
import { AppError, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { InvoicePdf } from "@/components/invoice-pdf";
import { getInvoice } from "@/services/billing";

export const GET = route<{ id: string }>(["sales:invoice:read"], async (_req, { user, params }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError(404, "Not found");
  const d = await getInvoice(id.data);
  if (!d) throw new AppError(404, "Not found");
  const { inv, sale, lines } = d;
  const buf = await renderToBuffer(InvoicePdf({
    number: inv.number, issueDate: inv.issueDate, dueDate: inv.dueDate, parties: inv.parties, saleRef: sale.ref, billRef: sale.billRef, notes: inv.notes, lines,
    subtotal: inv.subtotal, vatTotal: inv.vatTotal, total: inv.total, paid: inv.paidAmount,
  }));
  await audit({ action: "download_invoice", entity: "invoice", entityId: inv.id, userId: user.id, userEmail: user.email });
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${inv.number}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
});
