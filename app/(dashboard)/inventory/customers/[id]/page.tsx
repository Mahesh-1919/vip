import type { Metadata } from "next";
import { PartyEditPage } from "../../party-pages";

export const metadata: Metadata = { title: "Customer" };
export default function Page({ params }: PageProps<"/inventory/customers/[id]">) {
  return <PartyEditPage kind="customer" params={params} />;
}
