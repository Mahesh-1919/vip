import "server-only";
import * as OTPAuth from "otpauth";

const mk = (secret: string, label: string) =>
  new OTPAuth.TOTP({
    issuer: process.env.APP_NAME || "Vip Internationala",
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

export const newTotpSecret = () => new OTPAuth.Secret({ size: 20 }).base32;
export const totpUri = (secret: string, email: string) => mk(secret, email).toString();

/** Returns the matched time-step (for replay protection) or null. */
export function checkTotp(secret: string, token: string): number | null {
  const delta = mk(secret, "x").validate({ token: token.replace(/\s/g, ""), window: 1 });
  return delta === null ? null : Math.floor(Date.now() / 30_000) + delta;
}
