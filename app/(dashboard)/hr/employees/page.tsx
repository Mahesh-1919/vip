import type { Metadata } from "next";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { departments } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { daysUntil, formatDate } from "@/lib/dates";
import { listEmployees } from "@/services/hr/employees";
import { Pagination, qs } from "@/components/pagination";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = { title: "Employees" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function expiryFlag(e: Record<string, string | null>) {
  const ds = [e.visaExpiry, e.emiratesIdExpiry, e.passportExpiry, e.labourCardExpiry].map(daysUntil).filter((d): d is number => d !== null);
  if (!ds.length) return null;
  const min = Math.min(...ds);
  if (min < 0) return <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-xs text-destructive">Document expired</span>;
  if (min <= 60) return <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-600">Expires in {min}d</span>;
  return null;
}

export default async function EmployeesPage({ searchParams }: PageProps<"/hr/employees">) {
  const user = await requirePermission("hr:employee:read");
  const sp = await searchParams;
  const params = { q: one(sp.q).slice(0, 80), dept: one(sp.dept), status: one(sp.status), sort: one(sp.sort), dir: one(sp.dir) };
  const [{ rows, total, page, pages }, depts] = await Promise.all([
    listEmployees({ ...params, page: Number(one(sp.page)) || 1 }),
    db.select().from(departments).orderBy(asc(departments.name)),
  ]);
  const sortLink = (key: string, label: string) => {
    const dir = params.sort === key && params.dir !== "desc" ? "desc" : "asc";
    return <Link href={`/hr/employees${qs({ ...params, sort: key, dir, page: 1 })}`} className="hover:underline">{label}{params.sort === key ? (params.dir === "desc" ? " ↓" : " ↑") : ""}</Link>;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Employees</h1>
        {user.permissions.has("hr:employee:write") && <Link href="/hr/employees/new" className={buttonVariants()}>Add employee</Link>}
      </div>
      <form className="flex flex-wrap gap-2">
        <Input name="q" defaultValue={params.q} placeholder="Search name, code, email" />
        <NativeSelect name="dept" defaultValue={params.dept}>
          <NativeSelectOption value="">All departments</NativeSelectOption>
          {depts.map((d) => <NativeSelectOption key={d.id} value={d.id}>{d.name}</NativeSelectOption>)}
        </NativeSelect>
        <NativeSelect name="status" defaultValue={params.status}>
          <NativeSelectOption value="">All statuses</NativeSelectOption>
          {["active", "on_leave", "notice_period", "inactive", "terminated"].map((s) => <NativeSelectOption key={s} value={s}>{s.replace("_", " ")}</NativeSelectOption>)}
        </NativeSelect>
        <Button variant="outline" type="submit">Filter</Button>
      </form>
      <Card className="gap-0 overflow-hidden py-0">
        <CardContent className="px-0">
          <Table className="w-full text-sm">
            <TableHeader className="text-left text-muted-foreground border-b border-border">
              <TableRow><TableHead className="p-3">{sortLink("code", "Code")}</TableHead><TableHead className="p-3">{sortLink("name", "Name")}</TableHead><TableHead className="p-3">Department</TableHead><TableHead className="p-3">Designation</TableHead><TableHead className="p-3">{sortLink("joined", "Joined")}</TableHead><TableHead className="p-3">{sortLink("status", "Status")}</TableHead><TableHead className="p-3">Alerts</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  <TableCell className="p-3 font-mono text-xs">{r.empCode}</TableCell>
                  <TableCell className="p-3"><Link className="text-primary hover:underline" href={`/hr/employees/${r.id}`}>{r.name}</Link></TableCell>
                  <TableCell className="p-3">{r.department ?? "—"}</TableCell><TableCell className="p-3">{r.designation ?? "—"}</TableCell>
                  <TableCell className="p-3">{formatDate(r.joinDate)}</TableCell><TableCell className="p-3 capitalize">{r.status.replace("_", " ")}</TableCell>
                  <TableCell className="p-3">{expiryFlag(r)}</TableCell>
                </TableRow>
              ))}
              {!rows.length && <TableRow><TableCell colSpan={7} className="p-6 text-center text-muted-foreground">No employees found.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Pagination page={page} pages={pages} total={total} basePath="/hr/employees" params={params} />
    </div>
  );
}
