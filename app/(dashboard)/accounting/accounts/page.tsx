import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { listAccounts } from "@/services/accounting/ledger";
import { ActionForm } from "@/components/action-form";
import { CheckboxField, SelectField, TextField } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { addAccount, toggleAccount } from "../actions";

export const metadata: Metadata = { title: "Chart of accounts" };
const TYPES = ["asset", "liability", "equity", "income", "expense"] as const;

export default async function AccountsPage() {
  const user = await requirePermission("accounting:account:read");
  const list = await listAccounts();
  const canWrite = user.permissions.has("accounting:account:write");
  return (
    <div className="max-w-4xl flex flex-col gap-6">
      <PageHeader title="Chart of accounts" description="UAE default chart. System accounts are used by automatic postings and cannot be switched off; add your own accounts for manual journals." />
      {TYPES.map((t) => (
        <Card key={t}><CardHeader><CardTitle className="capitalize">{t === "income" ? "Income" : t === "asset" ? "Assets" : t === "liability" ? "Liabilities" : t === "equity" ? "Equity" : "Expenses"}</CardTitle></CardHeader><CardContent>
          <ul className="divide-y text-sm">
            {list.filter((a) => a.type === t).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <span className={a.isActive ? "" : "text-muted-foreground line-through"}><span className="font-mono text-xs text-muted-foreground">{a.code}</span> <Link className="hover:underline" href={`/accounting/ledger?account=${a.id}`}>{a.name}</Link> {a.isSystem && <Badge variant="secondary">System</Badge>} {a.isCash && <Badge variant="info">Cash / bank</Badge>}</span>
                {canWrite && !a.isSystem && <form action={toggleAccount}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="active" value={String(!a.isActive)} /><Button size="sm" variant="ghost" type="submit">{a.isActive ? "Disable" : "Enable"}</Button></form>}
              </li>
            ))}
          </ul></CardContent></Card>
      ))}
      {canWrite && (
        <Card><CardHeader><CardTitle>Add account</CardTitle></CardHeader><CardContent>
          <ActionForm action={addAccount} submit="Add account" className="grid gap-4 sm:grid-cols-3">
            <TextField name="code" label="Code" required placeholder="6200" inputMode="numeric" />
            <TextField name="name" label="Name" required />
            <SelectField name="type" label="Type" options={TYPES.map((t) => ({ value: t, label: t }))} />
            <CheckboxField name="isCash" label="Cash / bank account" />
          </ActionForm>
        </CardContent></Card>
      )}
    </div>
  );
}
