import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { listRequests } from "@/services/hr/leave";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cancelAction, decideAction } from "./actions";
import { LeaveTabs } from "./_components";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Leave requests" };
export const instant = false; // session-dependent page: see (dashboard)/layout.tsx

export default async function LeavePage({ searchParams }: PageProps<"/hr/leave">) {
  const user = await requirePermission("hr:leave:read");
  const sp = await searchParams;
  const status = (Array.isArray(sp.status) ? sp.status[0] : sp.status) ?? "";
  const rows = await listRequests({ status: ["pending", "approved", "rejected", "cancelled"].includes(status) ? status : undefined });
  const canApprove = user.permissions.has("hr:leave:approve");
  const canWrite = user.permissions.has("hr:leave:write");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Leave" description="Requests, balances and leave policies." />
      <LeaveTabs active="requests" canConfig={user.permissions.has("hr:config:read")} />
      <form className="flex gap-2 text-sm">
        <NativeSelect name="status" defaultValue={status} className="h-9 rounded-md border border-border bg-background px-3">
          <NativeSelectOption value="">All statuses</NativeSelectOption>{["pending", "approved", "rejected", "cancelled"].map((s) => <NativeSelectOption key={s} value={s}>{s}</NativeSelectOption>)}
        </NativeSelect>
        <Button variant="outline" type="submit">Filter</Button>
      </form>
      <Card className="gap-0 overflow-hidden py-0"><CardContent className="px-0">
        <Table className="w-full text-sm">
          <TableHeader className="text-left text-muted-foreground border-b border-border"><TableRow><TableHead className="p-3">Employee</TableHead><TableHead className="p-3">Type</TableHead><TableHead className="p-3">Dates</TableHead><TableHead className="p-3 text-right">Days</TableHead><TableHead className="p-3">Status</TableHead><TableHead className="p-3">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map(({ r, name, code, type }) => (
              <TableRow key={r.id} className="border-b border-border last:border-0 align-top">
                <TableCell className="p-3">{name} <span className="font-mono text-xs text-muted-foreground">{code}</span>{r.reason && <div className="text-xs text-muted-foreground">{r.reason}</div>}</TableCell>
                <TableCell className="p-3">{type}</TableCell>
                <TableCell className="p-3 whitespace-nowrap">{formatDate(r.fromDate)}{r.fromDate !== r.toDate && ` – ${formatDate(r.toDate)}`}{r.halfDay && <span className="text-xs text-muted-foreground"> ({r.halfDay} half)</span>}</TableCell>
                <TableCell className="p-3 text-right">{Number(r.days)}</TableCell>
                <TableCell className="p-3"><StatusBadge status={r.status} />{r.decisionNote && <div className="text-xs text-muted-foreground">{r.decisionNote}</div>}</TableCell>
                <TableCell className="p-3">
                  <div className="flex flex-wrap gap-2">
                    {r.status === "pending" && canApprove && (
                      <form action={decideAction} className="flex gap-1.5">
                        <input type="hidden" name="id" value={r.id} /><Input name="note" placeholder="Note" className="h-8 w-28" maxLength={300} />
                        <Button size="sm" name="decision" value="approve" type="submit">Approve</Button>
                        <Button size="sm" variant="outline" name="decision" value="reject" type="submit">Reject</Button>
                      </form>
                    )}
                    {(r.status === "pending" && canWrite || r.status === "approved" && canApprove) && (
                      <form action={cancelAction}><input type="hidden" name="id" value={r.id} /><Button size="sm" variant="ghost" type="submit">Cancel</Button></form>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && <TableRow><TableCell colSpan={6}><EmptyState title="No leave requests" hint="Requests you apply for or filter will appear here." /></TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
