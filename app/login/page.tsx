import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { loginAction } from "./actions";
import { CredentialsForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

async function RedirectIfSignedIn() {
  const user = await getCurrentUser();
  if (user && !user.mfaPending) redirect("/");
  return null;
}

export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center p-4 bg-muted">
      <Suspense>
        <RedirectIfSignedIn />
      </Suspense>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Mini ERP</CardTitle>
          <CardDescription>Sign in to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <CredentialsForm action={loginAction} />
        </CardContent>
      </Card>
    </main>
  );
}
