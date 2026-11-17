import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** KPI tile. Pass `href` to make it a link and `icon` for the corner badge. */
export function StatCard({ label, value, tone, href, hint, icon }: { label: React.ReactNode; value: React.ReactNode; tone?: "danger" | "warning" | "success"; href?: string; hint?: React.ReactNode; icon?: React.ReactNode }) {
  const card = (
    <Card className={cn("h-full gap-0 py-0 shadow-xs", href && "transition hover:border-primary/40 hover:shadow-md")}>
      <CardContent className="flex items-start justify-between gap-3 px-4 py-4">
        <div className="min-w-0">
          <div className="text-[13px] text-muted-foreground">{label}</div>
          <div className={cn("mt-1 truncate text-2xl font-semibold tracking-tight", tone === "danger" && "text-danger", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{value}</div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
        {icon && <div className={cn("grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary [&>svg]:size-[18px]", tone === "danger" && "bg-danger-bg text-danger", tone === "warning" && "bg-warning-bg text-warning")}>{icon}</div>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} className="block h-full rounded-xl focus-visible:outline-2">{card}</Link> : card;
}
