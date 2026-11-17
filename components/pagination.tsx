import { Pagination as P, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";

export function qs(params: Record<string, string | number | undefined | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "?";
}

/** URL-driven pager (server component friendly). */
export function Pagination({ page, pages, total, params, basePath }: {
  page: number; pages: number; total: number; basePath: string; params: Record<string, string | undefined>;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>{total} result{total === 1 ? "" : "s"} · page {page} of {pages}</span>
      <P className="mx-0 w-auto">
        <PaginationContent>
          <PaginationItem>{page > 1 ? <PaginationPrevious href={`${basePath}${qs({ ...params, page: page - 1 })}`} /> : <PaginationPrevious aria-disabled className="pointer-events-none opacity-50" />}</PaginationItem>
          <PaginationItem>{page < pages ? <PaginationNext href={`${basePath}${qs({ ...params, page: page + 1 })}`} /> : <PaginationNext aria-disabled className="pointer-events-none opacity-50" />}</PaginationItem>
        </PaginationContent>
      </P>
    </div>
  );
}
