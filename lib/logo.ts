import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let cached: Buffer | undefined;
/** The company logo as PNG bytes, for PDF documents (public/logo.png). */
export function logoPng(): { data: Buffer; format: "png" } {
  cached ??= readFileSync(join(process.cwd(), "public", "logo.png"));
  return { data: cached, format: "png" };
}
