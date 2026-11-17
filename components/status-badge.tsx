import { Badge } from "@/components/ui/badge";

type Tone = "success" | "warning" | "danger" | "info" | "secondary";

/** One mapping so every module colours the same status the same way. */
export const STATUS_TONE: Record<string, Tone> = {
  active: "success", approved: "success", paid: "success", present: "success", received: "success", delivered: "success",
  pending: "warning", draft: "warning", late: "warning", notice_period: "warning",
  on_leave: "info", finalized: "info", half_day: "info", in_transit: "info",
  rejected: "danger", absent: "danger", terminated: "danger", low: "danger",
  cancelled: "secondary", inactive: "secondary",
  unpaid: "info", partial: "warning", overdue: "danger", confirmed: "success",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge variant={STATUS_TONE[status] ?? "secondary"} className="capitalize">{label ?? status.replace(/_/g, " ")}</Badge>;
}
