import { TabsNav } from "@/components/tabs-nav";

export function StockTabs({ active, canAdjust }: { active: string; canAdjust: boolean }) {
  return <TabsNav active={active} tabs={[
    { key: "overview", href: "/inventory/stock", label: "Overview" },
    { key: "movements", href: "/inventory/stock/movements", label: "Movements" },
    { key: "adjust", href: "/inventory/stock/adjust", label: "Add / adjust", hidden: !canAdjust },
    { key: "transfer", href: "/inventory/stock/transfer", label: "Transfer", hidden: !canAdjust },
  ]} />;
}
