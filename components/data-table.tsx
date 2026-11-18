import * as React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  headClassName?: string;
  /** Makes the header a sort link: needs `sort` on the table. */
  sortKey?: string;
};

/**
 * Server-rendered table card. Describe columns once, get consistent header/empty/hover styles.
 * Sorting is URL-driven (works with server components): pass `sort` with the current state and a `href(sortKey, dir)` builder.
 */
export function DataTable<T>({ columns, rows, rowKey, empty, sort, className, dense, footer, scroll }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: { title: string; hint?: string; action?: React.ReactNode };
  sort?: { key?: string; dir?: string; href: (key: string, dir: "asc" | "desc") => string };
  className?: string;
  /** Tighter rows for spreadsheet-style registers. */
  dense?: boolean;
  /** Cap the height and keep the header visible while scrolling (long registers). */
  scroll?: boolean;
  /** Optional totals row: one entry per column key. */
  footer?: Record<string, React.ReactNode>;
}) {
  const align = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "");
  return (
    <Card className={cn("gap-0 overflow-hidden py-0", className)}>
      <Table containerClassName={scroll ? "max-h-[max(24rem,calc(100dvh-23rem))] overflow-y-auto" : undefined}>
        <TableHeader className={cn("bg-muted", scroll && "sticky top-0 z-10 shadow-[0_1px_0_var(--border)]")}>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.key} className={cn(dense ? "px-3" : "px-4", "whitespace-nowrap bg-muted text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", align(c.align), c.headClassName)}>
                {c.sortKey && sort ? (
                  <Link href={sort.href(c.sortKey, sort.key === c.sortKey && sort.dir !== "desc" ? "desc" : "asc")} className="hover:text-foreground">
                    {c.header}{sort.key === c.sortKey ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
                  </Link>
                ) : c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={rowKey(r)}>
              {columns.map((c) => <TableCell key={c.key} className={cn(dense ? "px-3 py-1.5 text-[13px]" : "px-4 py-3", align(c.align), c.className)}>{c.cell(r)}</TableCell>)}
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow className="hover:bg-transparent"><TableCell colSpan={columns.length}><EmptyState title={empty?.title ?? "Nothing to show"} hint={empty?.hint} action={empty?.action} /></TableCell></TableRow>
          )}
        </TableBody>
        {footer && rows.length > 0 && (
          <TableFooter><TableRow>{columns.map((c) => <TableCell key={c.key} className={cn(dense ? "px-3 py-1.5" : "px-4 py-3", "font-semibold", align(c.align))}>{footer[c.key] ?? ""}</TableCell>)}</TableRow></TableFooter>
        )}
      </Table>
    </Card>
  );
}
