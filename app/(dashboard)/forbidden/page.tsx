import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Access denied" };

export default function Forbidden() {
  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-semibold">Access denied</h1>
      <p className="mt-2 text-muted-foreground">Your role does not have permission to view this page.</p>
      <Link href="/" className="mt-4 inline-block text-primary underline">Back to dashboard</Link>
    </div>
  );
}
