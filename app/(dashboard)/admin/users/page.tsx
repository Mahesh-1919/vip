import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { roles, users } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createUser, setUserActive } from "./actions";
import { CreateUserForm } from "./create-form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requirePermission("admin:user:read");
  const canWrite = me.permissions.has("admin:user:write");
  const [list, roleList] = await Promise.all([
    db.select({
      id: users.id, name: users.name, email: users.email, active: users.isActive,
      mfa: users.totpEnabled, last: users.lastLoginAt, role: roles.name,
    }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).orderBy(asc(users.name)),
    db.select({ id: roles.id, name: roles.name }).from(roles).orderBy(asc(roles.name)),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Users</h1>
      {canWrite && (
        <Card>
          <CardHeader><CardTitle>Add user</CardTitle></CardHeader>
          <CardContent><CreateUserForm action={createUser} roles={roleList} /></CardContent>
        </Card>
      )}
      <Card className="gap-0 overflow-hidden py-0">
        <CardContent className="px-0">
          <Table className="w-full text-sm">
            <TableHeader className="text-left text-muted-foreground border-b border-border">
              <TableRow><TableHead className="p-3">Name</TableHead><TableHead className="p-3">Email</TableHead><TableHead className="p-3">Role</TableHead><TableHead className="p-3">2FA</TableHead><TableHead className="p-3">Last login</TableHead><TableHead className="p-3">Status</TableHead><TableHead className="p-3" /></TableRow>
            </TableHeader>
            <TableBody>
              {list.map((u) => (
                <TableRow key={u.id} className="border-b border-border last:border-0">
                  <TableCell className="p-3">{u.name}</TableCell><TableCell className="p-3">{u.email}</TableCell><TableCell className="p-3">{u.role}</TableCell>
                  <TableCell className="p-3">{u.mfa ? "On" : "Off"}</TableCell>
                  <TableCell className="p-3">{u.last ? u.last.toLocaleString("en-GB", { timeZone: "Asia/Dubai" }) : "—"}</TableCell>
                  <TableCell className="p-3">{u.active ? "Active" : "Inactive"}</TableCell>
                  <TableCell className="p-3 text-right">
                    {canWrite && u.id !== me.id && (
                      <form action={setUserActive}>
                        <input type="hidden" name="id" value={u.id} />
                        <input type="hidden" name="active" value={String(!u.active)} />
                        <Button size="sm" variant="outline" type="submit">{u.active ? "Deactivate" : "Activate"}</Button>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
