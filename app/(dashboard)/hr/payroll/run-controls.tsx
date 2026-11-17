"use client";

import { ActionForm } from "@/components/action-form";
import { Input } from "@/components/ui/input";
import type { ActionState } from "@/lib/action-state";

type A = (s: ActionState, f: FormData) => Promise<ActionState>;

export function RunControls({ status, canWrite, canFinalize, isAdmin, canExport, runId, recalc, finalize, paid, reopen, today }: {
  status: string; canWrite: boolean; canFinalize: boolean; isAdmin: boolean; canExport: boolean; runId: string; today: string;
  recalc: A; finalize: A; paid: A; reopen: A;
}) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      {status === "draft" && canWrite && <ActionForm action={recalc} submit="Recalculate" variant="outline" className="flex flex-col gap-2" />}
      {status === "draft" && canFinalize && <ActionForm action={finalize} submit="Finalise & lock" confirm="Finalising locks this payroll. Amounts can no longer be edited, and payslips and the WPS file become available. Only an Admin can reopen it." className="flex flex-col gap-2" resetOnSuccess={false} />}
      {status === "finalized" && canFinalize && (
        <ActionForm action={paid} submit="Mark as paid" confirm="Marking as paid is permanent: a paid payroll can no longer be reopened." className="flex items-end gap-2" resetOnSuccess={false}>
          <Input type="date" name="paidAt" defaultValue={today} className="w-44" required />
        </ActionForm>
      )}
      {status === "finalized" && isAdmin && (
        <ActionForm action={reopen} submit="Reopen (admin)" variant="destructive" confirm="This unlocks the payroll back to draft and is recorded in the audit log with your reason." className="flex items-end gap-2">
          <Input name="reason" placeholder="Reason for reopening" required minLength={5} maxLength={300} className="w-64" />
        </ActionForm>
      )}
      {status !== "draft" && canExport && <a href={`/api/hr/payroll/${runId}/sif`} className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm hover:bg-muted">Download WPS SIF</a>}
    </div>
  );
}
