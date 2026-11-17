import { cn } from "@/lib/utils";

/** GET form used for list filters: values land in the URL so lists stay server-rendered and shareable. */
export function FilterBar({ className, children, ...p }: React.ComponentProps<"form">) {
  return <form method="get" className={cn("flex flex-wrap items-center gap-2", className)} {...p}>{children}</form>;
}
