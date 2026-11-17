import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { employeeDocuments } from "@/db/schema";
import { AppError, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { readStored } from "@/lib/storage";

export const GET = route<{ docId: string }>(["hr:employee:sensitive"], async (_req, { user, params }) => {
  const docId = z.uuid().safeParse(params.docId);
  if (!docId.success) throw new AppError(404, "Not found");
  const [doc] = await db.select().from(employeeDocuments).where(eq(employeeDocuments.id, docId.data));
  if (!doc) throw new AppError(404, "Not found");
  await audit({ action: "download_document", entity: "employee", entityId: doc.employeeId, after: { documentId: doc.id }, userId: user.id, userEmail: user.email });
  return new Response(new Uint8Array(await readStored(doc.storageKey)), {
    headers: {
      "Content-Type": doc.mime,
      "Content-Disposition": `attachment; filename="${doc.fileName.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});
