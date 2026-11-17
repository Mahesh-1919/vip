import type { Metadata } from "next";
import { PartyEditPage } from "../../party-pages";

export const metadata: Metadata = { title: "Supplier" };
export default function Page({ params }: PageProps<"/inventory/suppliers/[id]">) {
  return <PartyEditPage kind="supplier" params={params} />;
}
