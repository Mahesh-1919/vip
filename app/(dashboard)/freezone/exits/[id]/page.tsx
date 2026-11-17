import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { getExit } from "@/services/freezone";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { deleteExitAction } from "../actions";
import { ExitForm } from "../exit-form";

export const metadata: Metadata = { title: "Exit bill" };

export default async function ExitPage({ params }: PageProps<"/freezone/exits/[id]">) {
  const user = await requirePermission("freezone:exit:read");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const exit = await getExit(id.data);
  if (!exit) notFound();
  const canWrite = user.permissions.has("freezone:exit:write");
  return (
    <div className="max-w-4xl flex flex-col gap-5">
      <PageHeader title={<span className="font-mono">{exit.boeNo}</span>} back={{ href: "/freezone/exits", label: "Exit bills" }} description={exit.importerName} />
      {canWrite ? <Card><CardContent><ExitForm exit={exit} /></CardContent></Card> : <Card><CardContent className="text-sm">You have read-only access.</CardContent></Card>}
      {canWrite && <ActionForm action={deleteExitAction.bind(null, exit.id) as never} submit="Delete exit bill" variant="destructive" resetOnSuccess={false} confirm="Delete this exit bill? This is recorded in the audit log but cannot be undone." />}
    </div>
  );
}
