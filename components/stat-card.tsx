import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** KPI tile. Pass `href` to make it a link. */
export function StatCard({ label, value, tone, href, hint }: { label: React.ReactNode; value: React.ReactNode; tone?: "danger" | "warning" | "success"; href?: string; hint?: React.ReactNode }) {
  const card = (
    <Card className={cn("h-full gap-0 py-0", href && "transition-shadow hover:shadow-md")}>
      <CardContent className="px-4 py-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={cn("text-xl font-semibold", tone === "danger" && "text-danger", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{value}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} className="block h-full">{card}</Link> : card;
}
