import { TabsNav } from "@/components/tabs-nav";

export function AttendanceTabs({ active }: { active: "daily" | "calendar" | "summary" }) {
  return <TabsNav active={active} tabs={[
    { key: "daily", href: "/hr/attendance", label: "Daily entry" },
    { key: "calendar", href: "/hr/attendance/calendar", label: "Employee calendar" },
    { key: "summary", href: "/hr/attendance/summary", label: "Monthly summary" },
  ]} />;
}

export function shiftMonth(m: string, delta: number) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
