"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const config = { imported: { label: "Imported", color: "var(--primary)" }, exported: { label: "Exported", color: "#f59e0b" } } satisfies ChartConfig;

/** Packages imported vs exported per month. */
export function FlowChart({ data }: { data: { month: string; imported: number; exported: number }[] }) {
  return (
    <ChartContainer config={config} className="h-56 w-full">
      <BarChart data={data} margin={{ left: 0, right: 4, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(v) => new Intl.NumberFormat("en", { notation: "compact" }).format(v)} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="imported" fill="var(--color-imported)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="exported" fill="var(--color-exported)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
