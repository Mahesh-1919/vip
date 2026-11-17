import { z } from "zod";
import { db } from "@/db";
import { employeeDocuments, employees } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppError, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { MAX_UPLOAD_BYTES, saveFile, sniff } from "@/lib/storage";
import { documentMetaSchema } from "@/validators/hr";

export const POST = route<{ id: string }>(["hr:employee:write", "hr:employee:sensitive"], async (req, { user, params }) => {
  const id = z.uuid().parse(params.id);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new AppError(422, "Choose a file");
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError(413, "File too large (max 5 MB)");
  const meta = documentMetaSchema.parse({ employeeId: id, type: form.get("type"), expiryDate: form.get("expiryDate") ?? "" });

  const [emp] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, id));
  if (!emp) throw new AppError(404, "Employee not found");

  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buf);
  if (!kind) throw new AppError(415, "Only PDF, PNG or JPEG files are allowed");
  const storageKey = await saveFile(buf, kind.ext, `employees/${id}`);

  const fileName = file.name.replace(/[^\w.\- ]/g, "_").slice(0, 120) || `document.${kind.ext}`;
  await db.transaction(async (tx) => {
    const [doc] = await tx.insert(employeeDocuments).values({
      employeeId: id, type: meta.type, fileName, storageKey, mime: kind.mime, size: buf.length,
      expiryDate: meta.expiryDate ?? null, uploadedBy: user.id,
    }).returning();
    await audit({ action: "upload_document", entity: "employee", entityId: id, after: { documentId: doc.id, type: meta.type, fileName }, userId: user.id, userEmail: user.email }, tx);
  });
  return { ok: true };
});
