import Image from "next/image";
import { cn } from "@/lib/utils";

/** The VIP crest. The artwork is 383x350, so height drives the size. */
export function BrandLogo({ size = 36, className }: { size?: number; className?: string }) {
  return <Image src="/logo.png" alt="" width={Math.round((size * 383) / 350)} height={size} priority className={cn("shrink-0 object-contain", className)} />;
}
