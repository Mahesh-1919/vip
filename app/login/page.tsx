import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Boxes, FileText, ShieldCheck, Users } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { APP_NAME } from "@/lib/brand";
import { loginAction } from "./actions";
import { CredentialsForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

async function RedirectIfSignedIn() {
  const user = await getCurrentUser();
  if (user && !user.mfaPending) redirect("/");
  return null;
}

const FEATURES = [
  { icon: Boxes, title: "Entry and exit bills, fully traced", text: "See which container came in, who received how many packages, and what was invoiced." },
  { icon: FileText, title: "UAE tax invoices", text: "Gap-free numbering, VAT, partial billing and payment tracking." },
  { icon: Users, title: "HR and payroll", text: "Staff register with document expiry alerts, leave, attendance and payslips." },
  { icon: ShieldCheck, title: "Built for control", text: "Role-based access, a full audit trail and locked records." },
];

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <Suspense><RedirectIfSignedIn /></Suspense>
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-primary/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex items-center gap-3 text-lg font-semibold text-white">
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"><Boxes size={20} /></span>{APP_NAME}
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-white">Run your free-zone trading desk from one place.</h2>
          <ul className="mt-8 flex flex-col gap-5">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-white/10 text-primary"><Icon size={16} /></span>
                <span><span className="block text-sm font-medium text-white">{title}</span><span className="text-sm text-sidebar-foreground/80">{text}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-sidebar-foreground/60">© {APP_NAME}. All rights reserved.</p>
      </aside>
      <section className="flex flex-col items-center justify-center bg-background p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 text-lg font-semibold lg:hidden">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Boxes size={18} /></span>{APP_NAME}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">Sign in to your account to continue.</p>
          <CredentialsForm action={loginAction} />
          <p className="mt-6 text-center text-xs text-muted-foreground">Forgot your password? Ask your administrator to reset it.</p>
        </div>
      </section>
    </main>
  );
}
