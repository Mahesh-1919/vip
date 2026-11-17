import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function PageHeader({ title, description, back, actions }: {
  title: React.ReactNode; description?: React.ReactNode; back?: { href: string; label: string }; actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      {back && <Link href={back.href} className="inline-flex w-fit items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft size={14} />{back.label}</Link>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1>{title}</h1>
          {description && <p className="mt-0.5 text-sm text-muted-foreground max-w-prose">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
