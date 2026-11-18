import { Document, Image, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { logoPng } from "@/lib/logo";
import type { InvoiceParties } from "@/db/schema";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#0f172a" },
  top: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  company: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", color: "#1a6b45", textAlign: "right" },
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
  grand: { flexDirection: "row", justifyContent: "space-between", padding: 6, backgroundColor: "#1a6b45", color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 11, marginTop: 4 },
  foot: { marginTop: 18, fontSize: 8, color: "#64748b" },
});

const n = (v: string | number, d = 2) => new Intl.NumberFormat("en-AE", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v));
const date = (iso: string) => iso.split("-").reverse().join("/");

export type InvoicePdfData = {
  number: string; issueDate: string; dueDate: string; parties: InvoiceParties; saleRef: string; billRef: string | null; notes: string | null;
  lines: { description: string; qty: string; unitPrice: string; vatRate: string; net: string; vat: string; total: string }[];
  subtotal: string; vatTotal: string; total: string; paid: string;
};
const currency = "AED";

export function InvoicePdf(d: InvoicePdfData) {
  const { company, customer } = d.parties;
  return (
    <Document title={`Tax Invoice ${d.number}`} author={company.name}>
      <Page size="A4" style={s.page}>
        <View style={s.top}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not an HTML img */}
            <Image src={logoPng()} style={{ width: 58, height: 53 }} />
            <View>
            <Text style={s.company}>{company.name}</Text>
            <Text style={s.muted}>{company.address}</Text>
            {company.phone ? <Text style={s.muted}>Tel: {company.phone}</Text> : null}
            {company.email ? <Text style={s.muted}>{company.email}</Text> : null}
            <Text>TRN: {company.trn ?? "—"}</Text>
            </View>
          </View>
          <View>
            <Text style={s.title}>TAX INVOICE</Text>
            <Text style={{ textAlign: "right" }}>No: {d.number}</Text>
          </View>
        </View>

        <View style={s.row2}>
          <View style={s.box}>
            <Text style={s.boxTitle}>BILL TO</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{customer.name}</Text>
            {customer.address ? <Text>{customer.address}</Text> : null}
            <Text>TRN / Tax ID: {customer.trn ?? "—"}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.boxTitle}>DETAILS</Text>
            <Text>Invoice date: {date(d.issueDate)}</Text>
            <Text>Due date: {date(d.dueDate)}</Text>
            <Text>Sale ref: {d.saleRef}{d.billRef ? `  ·  Bill: ${d.billRef}` : ""}</Text>
            <Text>Currency: AED</Text>
          </View>
        </View>

        <View style={s.th}>
          <Text style={s.c1}>Description</Text><Text style={s.c2}>Qty</Text><Text style={s.c3}>Unit price</Text>
          <Text style={s.c4}>Taxable amount</Text><Text style={s.c5}>VAT %</Text><Text style={s.c6}>VAT</Text><Text style={s.c7}>Total</Text>
        </View>
        {d.lines.map((l, i) => (
          <View key={i} style={s.tr} wrap={false}>
            <Text style={s.c1}>{l.description}</Text><Text style={s.c2}>{n(l.qty, 2)}</Text><Text style={s.c3}>{n(l.unitPrice, 2)}</Text>
            <Text style={s.c4}>{n(l.net)}</Text><Text style={s.c5}>{Number(l.vatRate) > 0 ? `${Number(l.vatRate)}%` : "0%"}</Text><Text style={s.c6}>{n(l.vat)}</Text><Text style={s.c7}>{n(l.total)}</Text>
          </View>
        ))}

        <View style={s.totals}>
          <View style={s.tl}><Text>Total excl. VAT</Text><Text>{currency} {n(d.subtotal)}</Text></View>
          <View style={s.tl}><Text>Total VAT</Text><Text>{currency} {n(d.vatTotal)}</Text></View>
          <View style={s.grand}><Text>TOTAL</Text><Text>{currency} {n(d.total)}</Text></View>
          {Number(d.paid) > 0 ? <View style={s.tl}><Text>Paid</Text><Text>{currency} {n(d.paid)}</Text></View> : null}
          {Number(d.paid) > 0 ? <View style={s.tl}><Text style={{ fontFamily: "Helvetica-Bold" }}>Balance due</Text><Text style={{ fontFamily: "Helvetica-Bold" }}>{currency} {n(Number(d.total) - Number(d.paid))}</Text></View> : null}
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
