import type { Metadata } from "next";
import QRCode from "qrcode";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { decryptField } from "@/lib/crypto";
import { totpUri } from "@/lib/totp";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { beginTotpEnrollment, confirmTotpEnrollment } from "./actions";
import { EnrollForm } from "./enroll-form";

export const metadata: Metadata = { title: "Security" };
export const instant = false; // session-dependent page: see (dashboard)/layout.tsx

export default async function SecurityPage() {
  const user = await requireUser({ allowUnenrolled: true });
  const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);

  let qr: string | null = null;
  let secret: string | null = null;
  if (!row.totpEnabled && row.totpSecretEnc) {
    secret = decryptField(row.totpSecretEnc);
    qr = await QRCode.toDataURL(totpUri(secret, user.email), { margin: 1, width: 192 });
  }

  return (
    <div className="max-w-xl flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Security</h1>
      {user.mfaRequired && !user.totpEnabled && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          Your role requires two-factor authentication. Enrol below to continue using the system.
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication (TOTP)</CardTitle>
          <CardDescription>{row.totpEnabled ? "Enabled for your account." : "Protect your account with an authenticator app."}</CardDescription>
        </CardHeader>
        <CardContent>
          {row.totpEnabled ? null : !qr ? (
            <form action={beginTotpEnrollment}><Button type="submit">Set up authenticator</Button></form>
          ) : (
            <div className="flex flex-col gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} width={192} height={192} alt="TOTP QR code" />
              <p className="text-xs text-muted-foreground break-all">Manual key: {secret}</p>
              <EnrollForm action={confirmTotpEnrollment} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
