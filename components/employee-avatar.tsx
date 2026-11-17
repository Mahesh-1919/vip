import { cn } from "@/lib/utils";

/** Round employee photo with an initials fallback. Photos are served by a permission-checked route. */
export function EmployeeAvatar({ id, name, hasPhoto, className }: { id: string; name: string; hasPhoto: boolean; className?: string }) {
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return hasPhoto ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/hr/employees/${id}/photo`} alt={name} width={56} height={56} loading="lazy" className={cn("size-14 rounded-md border object-cover", className)} />
  ) : (
    <span aria-hidden className={cn("grid size-14 place-items-center rounded-md border bg-muted text-sm font-semibold text-muted-foreground", className)}>{initials}</span>
  );
}
