"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-[70vh] place-items-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-danger-bg text-danger"><TriangleAlert /></span>
        <h1 className="text-xl">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">We could not complete that. Try again, and if it keeps happening contact your administrator{error.digest ? ` with reference ${error.digest}` : ""}.</p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
