import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { AppError, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { readStored, saveFile, sniff } from "@/lib/storage";

const MAX = 2 * 1024 * 1024;

export const GET = route<{ id: string }>(["hr:employee:read"], async (_req, { params }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError(404, "Not found");
  const [e] = await db.select({ key: employees.photoKey }).from(employees).where(eq(employees.id, id.data));
  if (!e?.key) throw new AppError(404, "No photo");
  const buf = await readStored(e.key);
  const kind = sniff(buf);
  if (!kind || kind.mime === "application/pdf") throw new AppError(404, "No photo");
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": kind.mime, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
});

export const POST = route<{ id: string }>(["hr:employee:write"], async (req, { user, params }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError(404, "Not found");
  const file = (await req.formData()).get("file");
  if (!(file instanceof File) || file.size === 0) throw new AppError(422, "Choose a photo");
  if (file.size > MAX) throw new AppError(413, "Photo too large (max 2 MB)");
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buf);
  if (!kind || kind.mime === "application/pdf") throw new AppError(415, "Photos must be PNG or JPEG");
  const [e] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, id.data));
  if (!e) throw new AppError(404, "Employee not found");
  const key = await saveFile(buf, kind.ext, `employees/${id.data}/photo`);
  await db.transaction(async (tx) => {
    await tx.update(employees).set({ photoKey: key }).where(eq(employees.id, id.data));
    await audit({ action: "update_photo", entity: "employee", entityId: id.data, userId: user.id, userEmail: user.email }, tx);
  });
  return { ok: true };
});
