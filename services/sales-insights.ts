import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

type Row = Record<string, unknown>;
const rows = async <T extends Row>(q: ReturnType<typeof sql>) => {
  const r = (await db.execute(q)) as unknown as T[] | { rows: T[] }; // postgres-js returns rows; PGlite returns { rows }
  return Array.isArray(r) ? r : r.rows;
};

/** Net value of a sale = sum of its lines (exact override when present). */
const SALE_NET = sql`(select coalesce(sum(coalesce(l.net_override, l.qty * l.unit_price)), 0) from sale_lines l where l.sale_id = s.id)`;

/** Everything the sales page charts show, in one round trip per chart. */
export async function salesInsights() {
  const monthly = await rows<{ m: string; invoiced: string; open: string; n: number }>(sql`
    select to_char(date_trunc('month', s.sale_date::date), 'YYYY-MM') as m,
      coalesce(sum(case when i.id is not null then ${SALE_NET} end), 0) as invoiced,
      coalesce(sum(case when i.id is null then ${SALE_NET} end), 0) as open,
      count(*)::int as n
    from sales s left join invoices i on i.sale_id = s.id
    where s.sale_date::date >= date_trunc('month', now()) - interval '11 months'
    group by 1`);
  const top = await rows<{ name: string; net: string }>(sql`
    select c.name, sum(${SALE_NET}) as net
    from sales s join customers c on c.id = s.customer_id
    where s.sale_date::date >= date_trunc('month', now()) - interval '11 months'
    group by c.name order by net desc limit 6`);
  const [pay] = await rows<{ paid: string; outstanding: string; overdue: string }>(sql`
    select coalesce(sum(paid_amount), 0) as paid,
      coalesce(sum(total - paid_amount) filter (where due_date::date >= current_date), 0) as outstanding,
      coalesce(sum(total - paid_amount) filter (where due_date::date < current_date), 0) as overdue
    from invoices`);

  const now = new Date();
  const keys = Array.from({ length: 12 }, (_, k) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - k), 1)).toISOString().slice(0, 7));
  const series = keys.map((k) => {
    const r = monthly.find((x) => x.m === k);
    const label = new Date(k + "-01T00:00:00Z").toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
    return { month: label, invoiced: Number(r?.invoiced ?? 0), open: Number(r?.open ?? 0), count: r?.n ?? 0 };
  });
  const total = (x: (typeof series)[number]) => x.invoiced + x.open;
  const thisM = total(series[11]), lastM = total(series[10]);
  const year = series.reduce((a, x) => a + total(x), 0);
  const count = series.reduce((a, x) => a + x.count, 0);
  return {
    series,
    top: top.map((t) => ({ name: t.name, net: Number(t.net) })),
    payments: [
      { key: "paid", label: "Collected", value: Number(pay?.paid ?? 0) },
      { key: "outstanding", label: "Outstanding", value: Number(pay?.outstanding ?? 0) },
      { key: "overdue", label: "Overdue", value: Number(pay?.overdue ?? 0) },
    ],
    kpi: { thisM, lastM, change: lastM > 0 ? ((thisM - lastM) / lastM) * 100 : null, year, count, avg: count ? year / count : 0 },
  };
}
