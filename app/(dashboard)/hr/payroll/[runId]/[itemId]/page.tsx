import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { formatAED } from "@/lib/money";
import { getItem } from "@/services/hr/payroll";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Payroll breakdown" };
export const instant = false; // session-dependent page: see (dashboard)/layout.tsx

function Col({ title, lines, total }: { title: string; lines: { name: string; amount: string; note?: string }[]; total: string }) {
  return (
    <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent>
      <ul className="divide-y divide-border text-sm">
        {lines.map((l, i) => <li key={i} className="py-2 flex justify-between"><span>{l.name}{l.note && <span className="block text-xs text-muted-foreground">{l.note}</span>}</span><span>{formatAED(l.amount)}</span></li>)}
        {!lines.length && <li className="py-2 text-muted-foreground">None</li>}
        <li className="py-2 flex justify-between font-semibold"><span>Total</span><span>{formatAED(total)}</span></li>
      </ul></CardContent></Card>
  );
}

export default async function ItemPage({ params }: PageProps<"/hr/payroll/[runId]/[itemId]">) {
  const user = await requirePermission("hr:payroll:read");
  const p = await params;
  const id = z.uuid().safeParse(p.itemId);
  if (!id.success) notFound();
  const row = await getItem(id.data);
  if (!row || row.run.id !== p.runId) notFound();
  const { item, run } = row;
  return (
    <div className="max-w-3xl flex flex-col gap-5">
      <div>
        <Link href={`/hr/payroll/${run.id}`} className="text-sm text-primary hover:underline">← Payroll run</Link>
        <h1 className="mt-1 text-2xl font-semibold">{item.employeeName} <span className="text-base font-normal font-mono text-muted-foreground">{item.empCode}</span></h1>
        <p className="text-sm text-muted-foreground">{item.designation ?? "—"} · {item.department ?? "—"} · {Number(item.paidDays)} of {item.basisDays} days paid ({Number(item.lopDays)} loss of pay)</p>
      </div>
      {item.warnings.map((w) => <p key={w} className="text-sm text-amber-600">⚠ {w}</p>)}
      <div className="grid gap-4 sm:grid-cols-2"><Col title="Earnings" lines={item.earnings} total={item.gross} /><Col title="Deductions" lines={item.deductions} total={item.totalDeductions} /></div>
      <Card className="gap-0 py-0"><CardContent className="p-4 flex justify-between text-lg font-semibold"><span>Net pay</span><span>{formatAED(item.net)}</span></CardContent></Card>
      {run.status !== "draft" && user.permissions.has("hr:payslip:read") && <a href={`/api/hr/payslips/${item.id}`} className="text-primary hover:underline">Download payslip PDF</a>}
    </div>
  );
}
