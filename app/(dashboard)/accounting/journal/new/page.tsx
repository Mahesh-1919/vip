import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { listAccounts } from "@/services/accounting/ledger";
import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { manualJournal } from "../../actions";

export const metadata: Metadata = { title: "Manual journal entry" };

export default async function NewJournalPage() {
  await requirePermission("accounting:journal:write");
  const accs = (await listAccounts()).filter((a) => a.isActive);
  return (
    <div className="max-w-4xl flex flex-col gap-5">
      <PageHeader title="Manual journal entry" back={{ href: "/accounting/journal", label: "Journal" }} description="For adjustments that no business document covers (opening balances, accruals, owner capital). Debits must equal credits." />
      <Card><CardContent>
        <ActionForm action={manualJournal} submit="Post entry" resetOnSuccess={false} className="flex flex-col gap-4" confirm="Posted entries cannot be edited or deleted; you can only reverse them.">
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField name="date" label="Date" type="date" required defaultValue={todayISO()} />
            <TextField className="sm:col-span-2" name="memo" label="Memo" required maxLength={200} />
          </div>
          <div className="grid grid-cols-[1fr_8rem_8rem] gap-2 text-sm sm:grid-cols-[2fr_1fr_1fr_2fr]">
            <div className="font-medium">Account</div><div className="font-medium text-right">Debit (AED)</div><div className="font-medium text-right">Credit (AED)</div><div className="hidden font-medium sm:block">Line note</div>
            {Array.from({ length: 6 }).map((_, n) => (
              <div key={n} className="contents">
                <NativeSelect name={`acct:${n}`} aria-label={`Line ${n + 1} account`}><NativeSelectOption value="">—</NativeSelectOption>{accs.map((a) => <NativeSelectOption key={a.id} value={a.id}>{a.code} · {a.name}</NativeSelectOption>)}</NativeSelect>
                <Input name={`dr:${n}`} inputMode="decimal" className="text-right" aria-label={`Line ${n + 1} debit`} /><Input name={`cr:${n}`} inputMode="decimal" className="text-right" aria-label={`Line ${n + 1} credit`} />
                <Input name={`memo:${n}`} className="hidden sm:block" aria-label={`Line ${n + 1} note`} />
              </div>
            ))}
          </div>
        </ActionForm>
      </CardContent></Card>
    </div>
  );
}
