import { FilterField } from "@/components/filter-bar";
import { Input } from "@/components/ui/input";

/** From / To date filters with visible labels (replaces two unlabeled date boxes). */
export function DateRange({ from, to }: { from?: string; to?: string }) {
  return (
    <>
      <FilterField label="From"><Input type="date" name="from" defaultValue={from} className="w-40 text-foreground" /></FilterField>
      <FilterField label="To"><Input type="date" name="to" defaultValue={to} className="w-40 text-foreground" /></FilterField>
    </>
  );
}
