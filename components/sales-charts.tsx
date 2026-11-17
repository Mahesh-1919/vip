"use client";

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const compact = (v: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(v);
const aed = (v: number) => "AED " + new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v);

const trendCfg = { invoiced: { label: "Invoiced", color: "var(--primary)" }, open: { label: "Not yet invoiced", color: "#f59e0b" } } satisfies ChartConfig;

/** Net sales per month, split by invoiced / not yet invoiced. */
export function SalesTrendChart({ data }: { data: { month: string; invoiced: number; open: number }[] }) {
  return (
    <ChartContainer config={trendCfg} className="h-64 w-full">
      <BarChart data={data} margin={{ left: 0, right: 4, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={compact} />
        <ChartTooltip content={<ChartTooltipContent formatter={(v, n) => <span className="flex w-full justify-between gap-4"><span className="text-muted-foreground">{trendCfg[n as keyof typeof trendCfg]?.label}</span><b>{aed(Number(v))}</b></span>} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="invoiced" stackId="a" fill="var(--color-invoiced)" />
        <Bar dataKey="open" stackId="a" fill="var(--color-open)" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

const topCfg = { net: { label: "Net sales", color: "var(--primary)" } } satisfies ChartConfig;

/** Biggest customers over the last 12 months. */
export function TopCustomersChart({ data }: { data: { name: string; net: number }[] }) {
  return (
    <ChartContainer config={topCfg} className="w-full" style={{ height: Math.max(160, data.length * 44) }}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 12 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={170} tick={{ fontSize: 12 }} tickFormatter={(v: string) => (v.length > 26 ? v.slice(0, 25) + "…" : v)} />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => <b>{aed(Number(v))}</b>} />} />
        <Bar dataKey="net" fill="var(--color-net)" radius={6} barSize={16} />
      </BarChart>
    </ChartContainer>
  );
}

const PAY_COLORS: Record<string, string> = { paid: "#1a6b45", outstanding: "#f59e0b", overdue: "#dc2626" };
const payCfg = { paid: { label: "Collected", color: "var(--primary)" }, outstanding: { label: "Outstanding", color: "#f59e0b" }, overdue: { label: "Overdue", color: "#dc2626" } } satisfies ChartConfig;

/** How much of the invoiced money is collected, waiting, or late. */
export function PaymentsChart({ data }: { data: { key: string; label: string; value: number }[] }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const rows = data.map((d) => ({ ...d, fill: PAY_COLORS[d.key] }));
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <ChartContainer config={payCfg} className="aspect-square h-44 w-44">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent hideLabel formatter={(v, n) => <span className="flex w-full justify-between gap-4"><span className="text-muted-foreground">{payCfg[n as keyof typeof payCfg]?.label}</span><b>{aed(Number(v))}</b></span>} />} />
            <Pie isAnimationActive={false} data={rows} dataKey="value" nameKey="key" innerRadius={55} outerRadius={80} strokeWidth={2} paddingAngle={total ? 2 : 0}>
              {rows.map((r) => <Cell key={r.key} fill={r.fill} />)}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><div className="text-xl font-semibold">{total ? Math.round((data[0].value / total) * 100) : 0}%</div><div className="text-[11px] text-muted-foreground">collected</div></div></div>
      </div>
      <ul className="grid w-full gap-1.5 text-sm">
        {data.map((d) => <li key={d.key} className="flex items-center justify-between"><span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: PAY_COLORS[d.key] }} />{d.label}</span><span className="tabular-nums font-medium">{aed(d.value)}</span></li>)}
      </ul>
    </div>
  );
}
