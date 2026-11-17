import type { Metadata } from "next";
import { PartyListPage } from "../party-pages";

export const metadata: Metadata = { title: "Customers" };
export default function Page({ searchParams }: PageProps<"/inventory/customers">) {
  return <PartyListPage kind="customer" searchParams={searchParams} />;
}
