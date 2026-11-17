import Link from "next/link";
import { SearchX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-[70vh] place-items-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground"><SearchX /></span>
        <h1 className="text-xl">Page not found</h1>
        <p className="text-sm text-muted-foreground">The page you are looking for does not exist, or you may not have access to it.</p>
        <Link href="/" className={buttonVariants()}>Back to dashboard</Link>
      </div>
    </main>
  );
}
