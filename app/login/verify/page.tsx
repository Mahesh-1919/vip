import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { verifyTotpAction } from "../actions";
import { CodeForm } from "../login-form";

export const metadata: Metadata = { title: "Two-factor verification" };

export default function VerifyPage() {
  return (
    <main className="min-h-screen grid place-items-center p-4 bg-muted">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Two-factor verification</CardTitle>
          <CardDescription>Enter the code from your authenticator app</CardDescription>
        </CardHeader>
        <CardContent>
          <CodeForm action={verifyTotpAction} />
        </CardContent>
      </Card>
    </main>
  );
}
