import type { Metadata } from "next";
import { PartyNewPage } from "../../party-pages";

export const metadata: Metadata = { title: "New supplier" };
export default function Page() {
  return <PartyNewPage kind="supplier" />;
}
