import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** KPI tile. Pass `href` to make it a link and `icon` for the corner badge. */
export function StatCard({ label, value, tone, href, hint, icon, featured }: { label: React.ReactNode; value: React.ReactNode; tone?: "danger" | "warning" | "success"; href?: string; hint?: React.ReactNode; icon?: React.ReactNode; featured?: boolean }) {
  const card = (
    <Card className={cn("h-full gap-0 py-0", featured && "bg-gradient-to-br from-primary to-primary-deep text-white", href && "transition hover:-translate-y-0.5 hover:shadow-md")}>
      <CardContent className="flex items-start justify-between gap-3 px-5 py-5">
        <div className="min-w-0">
          <div className={cn("text-sm font-medium", featured ? "text-white/85" : "text-muted-foreground")}>{label}</div>
          <div className={cn("mt-2 truncate text-3xl font-semibold tracking-tight", tone === "danger" && "text-danger", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{value}</div>
          {hint && <div className={cn("mt-2 text-xs", featured ? "text-white/80" : "text-muted-foreground")}>{hint}</div>}
        </div>
        {icon && <div className={cn("grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary [&>svg]:size-[18px]", featured && "bg-white text-primary", tone === "danger" && "bg-danger-bg text-danger", tone === "warning" && "bg-warning-bg text-warning")}>{icon}</div>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} className="block h-full rounded-xl focus-visible:outline-2">{card}</Link> : card;
}
