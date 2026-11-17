import type { Metadata } from "next";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { Plus } from "lucide-react";
import { db } from "@/db";
import { departments } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { daysUntil, formatDateMon } from "@/lib/dates";
import { listEmployees, PAGE_SIZES } from "@/services/hr/employees";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Employees" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Issue / expiry pair; expired dates are red, ones expiring within 90 days amber. */
function DatePair({ issue, expiry }: { issue: string | null; expiry: string | null }) {
  if (!issue && !expiry) return <span className="text-muted-foreground">—</span>;
  const d = daysUntil(expiry);
  const tone = d === null ? "" : d < 0 ? "font-medium text-danger" : d <= 90 ? "font-medium text-warning" : "";
  return (
    <div className="space-y-0.5 text-xs leading-snug">
      <div>Issue Date: {formatDateMon(issue)}</div>
      <div className={tone}>Expiry Date: {formatDateMon(expiry)}{d !== null && d < 0 ? " (expired)" : d !== null && d <= 90 ? ` (${d}d left)` : ""}</div>
    </div>
  );
}

export default async function EmployeesPage({ searchParams }: PageProps<"/hr/employees">) {
  const user = await requirePermission("hr:employee:read");
  const sp = await searchParams;
  const params = { q: one(sp.q).slice(0, 80), dept: one(sp.dept), status: one(sp.status), size: one(sp.size) };
  const sensitive = user.permissions.has("hr:employee:sensitive");
  const [res, depts] = await Promise.all([
    listEmployees({ ...params, size: Number(params.size) || 10, page: Number(one(sp.page)) || 1, sort: "name" }, { sensitive }),
    db.select().from(departments).orderBy(asc(departments.name)),
  ]);
  const keep = { ...params, size: String(res.size) };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Company Staff</h1>
          <p className="text-sm text-muted-foreground">Number of records : <b className="text-foreground">{res.total}</b></p>
        </div>
        {user.permissions.has("hr:employee:write") && <Link href="/hr/employees/new" className={buttonVariants()}><Plus size={16} />Add employee</Link>}
      </div>

      <FilterBar>
        <label className="flex items-center gap-2 text-sm">Show
          <NativeSelect name="size" defaultValue={String(res.size)} wrapperClassName="w-24">{PAGE_SIZES.map((s) => <NativeSelectOption key={s} value={s}>{s}</NativeSelectOption>)}</NativeSelect> entries</label>
        <NativeSelect name="dept" defaultValue={params.dept} wrapperClassName="w-52"><NativeSelectOption value="">All departments</NativeSelectOption>{depts.map((d) => <NativeSelectOption key={d.id} value={d.id}>{d.name}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect name="status" defaultValue={params.status} wrapperClassName="w-40"><NativeSelectOption value="">All statuses</NativeSelectOption>{["active", "on_leave", "notice_period", "inactive", "terminated"].map((s) => <NativeSelectOption key={s} value={s}>{s.replace("_", " ")}</NativeSelectOption>)}</NativeSelect>
        <div className="ml-auto flex items-center gap-2">
          <Input name="q" defaultValue={params.q} placeholder="Search name, ID or passport" className="w-64" />
          <Button variant="outline" type="submit">Search</Button>
        </div>
      </FilterBar>

      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow>
              <TableHead className="px-4">Picture</TableHead><TableHead className="px-4">Employee ID</TableHead><TableHead className="px-4">Full Name</TableHead>
              <TableHead className="px-4">Passport No.</TableHead><TableHead className="px-4">Passport Details</TableHead><TableHead className="px-4">Designation</TableHead>
              <TableHead className="px-4">Status</TableHead><TableHead className="px-4">Visa / ID Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {res.rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="px-4 py-2"><EmployeeAvatar id={r.id} name={r.name} hasPhoto={!!r.photoKey} /></TableCell>
                <TableCell className="px-4 font-mono text-xs">{r.empCode}</TableCell>
                <TableCell className="px-4 whitespace-normal"><Link href={`/hr/employees/${r.id}`} className="font-medium uppercase text-primary hover:underline">{r.name}</Link>{r.department && <div className="text-xs normal-case text-muted-foreground">{r.department}</div>}</TableCell>
                <TableCell className="px-4 font-mono text-xs uppercase">{r.passportNo ?? "—"}</TableCell>
                <TableCell className="px-4"><DatePair issue={r.passportIssueDate} expiry={r.passportExpiry} /></TableCell>
                <TableCell className="px-4">{r.designation ?? "—"}</TableCell>
                <TableCell className="px-4"><StatusBadge status={r.status} /></TableCell>
                <TableCell className="px-4"><DatePair issue={r.visaIssueDate} expiry={r.visaExpiry} /></TableCell>
              </TableRow>
            ))}
            {!res.rows.length && <TableRow><TableCell colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No employees found.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
      <Pagination page={res.page} pages={res.pages} total={res.total} basePath="/hr/employees" params={keep} />
    </div>
  );
}
