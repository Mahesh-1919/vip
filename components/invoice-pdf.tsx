import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { InvoiceParties } from "@/db/schema";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#0f172a" },
  top: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  company: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", color: "#0f766e", textAlign: "right" },
  muted: { color: "#64748b" },
  draft: { color: "#b91c1c", fontFamily: "Helvetica-Bold", textAlign: "right" },
  box: { flex: 1, padding: 8, border: "0.5pt solid #e2e8f0", borderRadius: 3 },
  boxTitle: { fontFamily: "Helvetica-Bold", marginBottom: 3, color: "#64748b" },
  row2: { flexDirection: "row", gap: 10, marginBottom: 12 },
  th: { flexDirection: "row", backgroundColor: "#f1f5f9", padding: 5, fontFamily: "Helvetica-Bold" },
  tr: { flexDirection: "row", padding: 5, borderBottom: "0.5pt solid #e2e8f0" },
  c1: { flex: 4 }, c2: { flex: 1, textAlign: "right" }, c3: { flex: 1.3, textAlign: "right" }, c4: { flex: 1.3, textAlign: "right" }, c5: { flex: 0.9, textAlign: "right" }, c6: { flex: 1.2, textAlign: "right" }, c7: { flex: 1.4, textAlign: "right" },
  totals: { marginTop: 10, alignSelf: "flex-end", width: 240 },
  tl: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: { flexDirection: "row", justifyContent: "space-between", padding: 6, backgroundColor: "#0f766e", color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 11, marginTop: 4 },
  foot: { marginTop: 18, fontSize: 8, color: "#64748b" },
});

const n = (v: string | number, d = 2) => new Intl.NumberFormat("en-AE", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v));
const date = (iso: string) => iso.split("-").reverse().join("/");
const CAT: Record<string, string> = { standard: "5%", zero: "0%", exempt: "Exempt", out_of_scope: "N/A" };

export type InvoicePdfData = {
  number: string | null; draft: boolean; issueDate: string; supplyDate: string; dueDate: string; currency: string; exchangeRate: string;
  parties: InvoiceParties; saleRef: string; containerNo: string | null; notes: string | null;
  lines: { description: string; qty: string; unitPrice: string; vatCategory: string; vatRate: string; net: string; vat: string; total: string }[];
  subtotal: string; vatTotal: string; total: string; vatAed: string; paid: string;
};

export function InvoicePdf(d: InvoicePdfData) {
  const { company, customer } = d.parties;
  const foreign = d.currency !== "AED";
  return (
    <Document title={`Tax Invoice ${d.number ?? "DRAFT"}`} author={company.name}>
      <Page size="A4" style={s.page}>
        <View style={s.top}>
          <View>
            <Text style={s.company}>{company.name}</Text>
            <Text style={s.muted}>{company.address}</Text>
            {company.phone ? <Text style={s.muted}>Tel: {company.phone}</Text> : null}
            {company.email ? <Text style={s.muted}>{company.email}</Text> : null}
            <Text>TRN: {company.trn ?? "—"}</Text>
          </View>
          <View>
            <Text style={s.title}>TAX INVOICE</Text>
            <Text style={{ textAlign: "right" }}>No: {d.number ?? "—"}</Text>
            {d.draft ? <Text style={s.draft}>DRAFT: not a valid tax invoice</Text> : null}
          </View>
        </View>

        <View style={s.row2}>
          <View style={s.box}>
            <Text style={s.boxTitle}>BILL TO</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{customer.name}</Text>
            {customer.address ? <Text>{customer.address}</Text> : null}
            {customer.country ? <Text>Country: {customer.country}</Text> : null}
            <Text>TRN / Tax ID: {customer.trn ?? "—"}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.boxTitle}>DETAILS</Text>
            <Text>Invoice date: {date(d.issueDate)}</Text>
            <Text>Date of supply: {date(d.supplyDate)}</Text>
            <Text>Due date: {date(d.dueDate)}</Text>
            <Text>Sale ref: {d.saleRef}{d.containerNo ? `  ·  Container: ${d.containerNo}` : ""}</Text>
            <Text>Currency: {d.currency}{foreign ? `  (1 ${d.currency} = ${n(d.exchangeRate, 4)} AED)` : ""}</Text>
          </View>
        </View>

        <View style={s.th}>
          <Text style={s.c1}>Description</Text><Text style={s.c2}>Qty</Text><Text style={s.c3}>Unit price</Text>
          <Text style={s.c4}>Taxable amount</Text><Text style={s.c5}>VAT %</Text><Text style={s.c6}>VAT</Text><Text style={s.c7}>Total</Text>
        </View>
        {d.lines.map((l, i) => (
          <View key={i} style={s.tr} wrap={false}>
            <Text style={s.c1}>{l.description}</Text><Text style={s.c2}>{n(l.qty, 2)}</Text><Text style={s.c3}>{n(l.unitPrice, 2)}</Text>
            <Text style={s.c4}>{n(l.net)}</Text><Text style={s.c5}>{CAT[l.vatCategory] ?? l.vatRate + "%"}</Text><Text style={s.c6}>{n(l.vat)}</Text><Text style={s.c7}>{n(l.total)}</Text>
          </View>
        ))}

        <View style={s.totals}>
          <View style={s.tl}><Text>Total excl. VAT</Text><Text>{d.currency} {n(d.subtotal)}</Text></View>
          <View style={s.tl}><Text>Total VAT</Text><Text>{d.currency} {n(d.vatTotal)}</Text></View>
          {foreign ? <View style={s.tl}><Text>Total VAT in AED</Text><Text>AED {n(d.vatAed)}</Text></View> : null}
          <View style={s.grand}><Text>TOTAL</Text><Text>{d.currency} {n(d.total)}</Text></View>
          {Number(d.paid) > 0 ? <View style={s.tl}><Text>Paid</Text><Text>{d.currency} {n(d.paid)}</Text></View> : null}
          {Number(d.paid) > 0 ? <View style={s.tl}><Text style={{ fontFamily: "Helvetica-Bold" }}>Balance due</Text><Text style={{ fontFamily: "Helvetica-Bold" }}>{d.currency} {n(Number(d.total) - Number(d.paid))}</Text></View> : null}
        </View>

        {company.bankName || company.iban ? (
          <View style={{ marginTop: 14 }}><Text style={s.boxTitle}>PAYMENT DETAILS</Text><Text>{company.bankName ?? ""}{company.iban ? `  ·  IBAN: ${company.iban}` : ""}</Text></View>
        ) : null}
        {d.notes ? <Text style={{ marginTop: 8 }}>Notes: {d.notes}</Text> : null}
        <Text style={s.foot}>{company.terms ?? "Thank you for your business."}</Text>
      </Page>
    </Document>
  );
}
