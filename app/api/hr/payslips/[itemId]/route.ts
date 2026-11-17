import { renderToBuffer } from "@react-pdf/renderer";
import { z } from "zod";
import { AppError, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { PayslipPdf } from "@/components/payslip-pdf";
import { getCompany } from "@/services/company";
import { getItem } from "@/services/hr/payroll";

export const GET = route<{ itemId: string }>(["hr:payslip:read"], async (_req, { user, params }) => {
  const id = z.uuid().safeParse(params.itemId);
  if (!id.success) throw new AppError(404, "Not found");
  const row = await getItem(id.data);
  if (!row) throw new AppError(404, "Not found");
  if (row.run.status === "draft") throw new AppError(409, "Payslips are available once the payroll is finalised");
  const company = await getCompany();
  const buf = await renderToBuffer(PayslipPdf({ company: { name: company.name, address: company.address }, year: row.run.year, month: row.run.month, item: row.item }));
  await audit({ action: "download_payslip", entity: "payroll_item", entityId: row.item.id, userId: user.id, userEmail: user.email });
  const name = `payslip-${row.item.empCode}-${row.run.year}-${String(row.run.month).padStart(2, "0")}.pdf`;
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
});
