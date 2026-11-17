import { z } from "zod";
import { AppError, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { buildSif } from "@/services/hr/payroll";

export const GET = route<{ runId: string }>(["hr:payroll:export", "hr:employee:sensitive"], async (_req, { user, params }) => {
  const id = z.uuid().safeParse(params.runId);
  if (!id.success) throw new AppError(404, "Not found");
  const sif = await buildSif(id.data);
  if (sif.errors.length) throw new AppError(422, "SIF cannot be generated", sif.errors);
  await audit({ action: "export_sif", entity: "payroll_run", entityId: id.data, userId: user.id, userEmail: user.email });
  return new Response(sif.content, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${sif.filename}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
});
