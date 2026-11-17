import { describe, expect, it } from "vitest";
import { decryptField, encryptField } from "@/lib/crypto";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/lib/password";
import { DEFAULT_ROLES, PERMISSIONS } from "@/lib/rbac";
import { redact } from "@/lib/redact";

const perms = (key: string) => new Set(DEFAULT_ROLES.find((r) => r.key === key)!.permissions);

describe("crypto", () => {
  it("round-trips and uses a fresh IV", () => {
    const a = encryptField("AE070331234567890123456");
    expect(a).not.toContain("AE07");
    expect(decryptField(a)).toBe("AE070331234567890123456");
    expect(encryptField("x")).not.toBe(encryptField("x"));
  });
  it("rejects tampered ciphertext", () => {
    const p = encryptField("secret").split(".");
    p[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptField(p.join("."))).toThrow();
  });
});

describe("password", () => {
  it("hashes with argon2id and verifies", async () => {
    const h = await hashPassword("Correct-Horse-9");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "Correct-Horse-9")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
  });
  it("enforces policy", () => {
    expect(passwordPolicyError("short1A")).toBeTruthy();
    expect(passwordPolicyError("LongEnough123")).toBeNull();
  });
});

describe("rbac", () => {
  it("admin has every permission", () => expect(perms("admin").size).toBe(PERMISSIONS.length));
  it("HR is limited to HRMS", () => {
    for (const p of perms("hr_manager")) expect(p === "dashboard:view" || p.startsWith("hr:")).toBe(true);
  });
  it("operations manager only touches the free zone register", () => {
    for (const p of perms("operations_manager")) expect(p === "dashboard:view" || p.startsWith("freezone:")).toBe(true);
    expect(perms("operations_manager").has("hr:employee:read")).toBe(false);
  });
  it("HR cannot touch the free zone register", () => expect(perms("hr_manager").has("freezone:entry:read")).toBe(false));
});

describe("audit redaction", () => {
  it("masks sensitive keys deeply", () => {
    expect(redact({ email: "a@b.c", passwordHash: "x", nested: { totpSecretEnc: "y", iban: "z" } })).toEqual({
      email: "a@b.c", passwordHash: "[redacted]", nested: { totpSecretEnc: "[redacted]", iban: "[redacted]" },
    });
  });
});
