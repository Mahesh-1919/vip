import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended argon2id parameters (m=19 MiB, t=2, p=1).
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string) => hash(pw, OPTS);
export async function verifyPassword(hashed: string, pw: string) {
  try { return await verify(hashed, pw); } catch { return false; }
}

// Burns the same CPU as a real check when the e-mail does not exist (timing equalisation).
let dummy: Promise<string> | undefined;
export async function dummyVerify(pw: string) {
  dummy ??= hashPassword("not-a-real-password");
  await verifyPassword(await dummy, pw);
}

export function passwordPolicyError(pw: string): string | null {
  if (pw.length < 12) return "Password must be at least 12 characters";
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return "Use upper-case, lower-case and a number";
  return null;
}
