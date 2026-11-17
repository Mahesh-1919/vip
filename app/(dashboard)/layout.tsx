import { Suspense } from "react";
import { AppFrame } from "@/components/app-frame";
import { requireUser } from "@/lib/auth";
import { NAV } from "@/lib/nav";
import { logoutAction } from "../login/actions";

async function Shell({ children }: { children: React.ReactNode }) {
  const user = await requireUser({ allowUnenrolled: true });
  // Roles that must have 2FA are forced to enrol first: only the Security page is reachable.
  const needsEnrol = user.mfaRequired && !user.totpEnabled;
  const sections = needsEnrol ? [] : NAV
    .map((s) => ({ title: s.title, items: s.items.filter((i) => user.permissions.has(i.permission)).map(({ label, href, icon }) => ({ label, href, icon })) }))
    .filter((s) => s.items.length);
  return (
    <AppFrame sections={sections} user={{ name: user.name, role: user.role.name, email: user.email }} logout={logoutAction}>
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
