import { Suspense } from "react";
import { AppFrame } from "@/components/app-frame";
import { requireUser } from "@/lib/auth";
import { NAV } from "@/lib/nav";
import { APP_NAME } from "@/lib/brand";
import { getCompany } from "@/services/company";
import { logoutAction } from "../login/actions";

/**
 * Every page behind the login depends on the session cookie, so none of it can be part of a static shell.
 * Opting out of instant-navigation validation keeps the dev overlay free of false alarms (see Next docs: instant navigation, "Opting out").
 */
export const instant = false;

async function Shell({ children }: { children: React.ReactNode }) {
  const [user, company] = await Promise.all([requireUser({ allowUnenrolled: true }), getCompany()]);
  // Roles that must have 2FA are forced to enrol first: only the Security page is reachable.
  const needsEnrol = user.mfaRequired && !user.totpEnabled;
  const sections = needsEnrol ? [] : NAV
    .map((s) => ({ title: s.title, items: s.items.filter((i) => user.permissions.has(i.permission)).map(({ label, href, icon }) => ({ label, href, icon })) }))
    .filter((s) => s.items.length);
  return (
    <AppFrame appName={APP_NAME} companyName={company.name} sections={sections} user={{ name: user.name, role: user.role.name, email: user.email }} logout={logoutAction}>
      {children}
    </AppFrame>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading…</div>}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
