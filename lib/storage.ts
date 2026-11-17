import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomToken } from "./crypto";

/**
 * Local-disk storage behind a tiny interface. Swap the body for S3/Supabase Storage in production
 * if the app runs on ephemeral disk. Files live OUTSIDE /public and are only served via
 * permission-checked route handlers.
 */
const ROOT = path.resolve(process.env.UPLOAD_DIR ?? "uploads");
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: "application/pdf", ext: "pdf", test: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];

/** Detects the type from file CONTENT (never trusts the client-supplied MIME or extension). */
export function sniff(buf: Buffer) {
  return SIGNATURES.find((s) => s.test(buf)) ?? null;
}

export async function saveFile(buf: Buffer, ext: string, folder: string): Promise<string> {
  const key = `${folder}/${randomToken(24)}.${ext}`;
  const full = path.join(ROOT, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf, { mode: 0o600 });
  return key;
}

export async function readStored(key: string): Promise<Buffer> {
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Bad storage key");
  return readFile(full);
}
