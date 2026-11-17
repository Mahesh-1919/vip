"use client";

import Link from "next/link";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Route-based tabs (each tab is a link) built on shadcn Tabs. */
export function TabsNav({ active, tabs }: { active: string; tabs: { key: string; href: string; label: string; hidden?: boolean }[] }) {
  return (
    <Tabs value={active}>
      <TabsList className="h-auto flex-wrap justify-start">
        {tabs.filter((t) => !t.hidden).map((t) => (
          <TabsTrigger key={t.key} value={t.key} asChild><Link href={t.href}>{t.label}</Link></TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
