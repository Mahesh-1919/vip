import { TabsNav } from "@/components/tabs-nav";

export function LeaveTabs({ active, canConfig }: { active: string; canConfig: boolean }) {
  return <TabsNav active={active} tabs={[
    { key: "requests", href: "/hr/leave", label: "Requests" },
    { key: "new", href: "/hr/leave/new", label: "Apply for leave" },
    { key: "balances", href: "/hr/leave/balances", label: "Balances" },
    { key: "types", href: "/hr/leave/types", label: "Leave types", hidden: !canConfig },
  ]} />;
}
