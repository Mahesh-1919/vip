import type { Metadata } from "next";
import { PartyListPage } from "../party-pages";

export const metadata: Metadata = { title: "Suppliers" };
export default function Page({ searchParams }: PageProps<"/inventory/suppliers">) {
  return <PartyListPage kind="supplier" searchParams={searchParams} />;
}
