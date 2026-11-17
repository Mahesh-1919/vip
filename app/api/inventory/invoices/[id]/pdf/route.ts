import { renderToBuffer } from "@react-pdf/renderer";
import { z } from "zod";
import { AppError, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { InvoicePdf } from "@/components/invoice-pdf";
import { getCompany } from "@/services/company";
import { getInvoice } from "@/services/sales/invoicing";
import { db } from "@/db";
import { containers } from "@/db/schema";
import { eq } from "drizzle-orm";

export const GET = route<{ id: string }>(["inventory:invoice:read"], async (_req, { user, params }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError(404, "Not found");
  const d = await getInvoice(id.data);
  if (!d) throw new AppError(404, "Not found");
  const { inv, customer, sale } = d;
  const draft = inv.status === "draft";
  // Drafts preview with today's company profile; issued invoices always use the frozen snapshot.
  const parties = inv.parties ?? await (async () => {
    const c = await getCompany();
    return { company: { name: c.name, address: c.address, trn: c.trn, phone: c.phone, email: c.email, bankName: c.bankName, iban: c.iban, terms: c.invoiceTerms }, customer: { name: customer.name, address: customer.address, trn: customer.taxId, country: customer.country } };
  })();
  const [cont] = sale.containerId ? await db.select({ no: containers.containerNo }).from(containers).where(eq(containers.id, sale.containerId)) : [];
  const buf = await renderToBuffer(InvoicePdf({
    number: inv.number, draft, issueDate: inv.issueDate, supplyDate: inv.supplyDate, dueDate: inv.dueDate, currency: inv.currency, exchangeRate: inv.exchangeRate,
    parties, saleRef: sale.ref, containerNo: cont?.no ?? null, notes: inv.notes, lines: d.lines,
    subtotal: inv.subtotal, vatTotal: inv.vatTotal, total: inv.total, vatAed: inv.vatAed, paid: inv.paidAmount,
  }));
  await audit({ action: "download_invoice", entity: "invoice", entityId: inv.id, userId: user.id, userEmail: user.email });
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${(inv.number ?? "draft-" + inv.id.slice(0, 8)).replace(/[^\w.-]/g, "_")}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
});
