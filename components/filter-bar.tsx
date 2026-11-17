import { cn } from "@/lib/utils";

/**
 * GET form used for list filters: values land in the URL so lists stay server-rendered and shareable.
 * Rendered as a toolbar card; pass `plain` when it already sits inside a card.
 */
export function FilterBar({ className, plain, children, ...p }: React.ComponentProps<"form"> & { plain?: boolean }) {
  return <form method="get" className={cn("flex flex-wrap items-end gap-x-3 gap-y-3", !plain && "rounded-xl border bg-card p-3 shadow-xs", className)} {...p}>{children}</form>;
}

/** A labelled field for use inside a FilterBar. */
export function FilterField({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return <label className={cn("flex flex-col gap-1 text-xs font-medium text-muted-foreground", className)}>{label}{children}</label>;
}
