import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { PayLine } from "@/db/schema";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#0f172a" },
  head: { borderBottom: "1pt solid #0f766e", paddingBottom: 8, marginBottom: 12 },
  company: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  muted: { color: "#64748b" },
  title: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 12 },
  cell: { width: "50%", flexDirection: "row", paddingVertical: 2 },
  label: { width: 90, color: "#64748b" },
  cols: { flexDirection: "row", gap: 16 },
  col: { flex: 1 },
  th: { backgroundColor: "#f1f5f9", padding: 5, fontFamily: "Helvetica-Bold", flexDirection: "row", justifyContent: "space-between" },
  row: { padding: 5, flexDirection: "row", justifyContent: "space-between", borderBottom: "0.5pt solid #e2e8f0" },
  note: { fontSize: 8, color: "#64748b" },
  total: { padding: 5, flexDirection: "row", justifyContent: "space-between", fontFamily: "Helvetica-Bold" },
  net: { marginTop: 14, padding: 10, backgroundColor: "#0f766e", color: "#fff", flexDirection: "row", justifyContent: "space-between", fontSize: 13, fontFamily: "Helvetica-Bold" },
  foot: { marginTop: 18, fontSize: 8, color: "#64748b" },
});

const aed = (v: string) => new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export type PayslipData = {
  company: { name: string; address: string };
  year: number; month: number;
  item: { empCode: string; employeeName: string; designation: string | null; department: string | null; basisDays: number; lopDays: string; paidDays: string; earnings: PayLine[]; deductions: PayLine[]; gross: string; totalDeductions: string; net: string };
};

function Lines({ title, lines, total }: { title: string; lines: PayLine[]; total: string }) {
  return (
    <View style={s.col}>
      <View style={s.th}><Text>{title}</Text><Text>AED</Text></View>
      {lines.map((l, i) => (
        <View key={i} style={s.row}>
          <View><Text>{l.name}</Text>{l.note ? <Text style={s.note}>{l.note}</Text> : null}</View>
          <Text>{aed(l.amount)}</Text>
        </View>
      ))}
      {!lines.length && <View style={s.row}><Text style={s.muted}>—</Text></View>}
      <View style={s.total}><Text>Total {title.toLowerCase()}</Text><Text>{aed(total)}</Text></View>
    </View>
  );
}

export function PayslipPdf({ company, year, month, item }: PayslipData) {
  const period = `${MONTHS[month - 1]} ${year}`;
  return (
    <Document title={`Payslip ${item.empCode} ${period}`} author={company.name}>
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          <Text style={s.company}>{company.name}</Text>
          <Text style={s.muted}>{company.address}</Text>
          <Text style={s.title}>Payslip for {period}</Text>
        </View>
        <View style={s.grid}>
          {[["Employee", item.employeeName], ["Employee ID", item.empCode], ["Designation", item.designation ?? "—"], ["Department", item.department ?? "—"],
            ["Pay days", `${item.paidDays} of ${item.basisDays}`], ["Loss of pay days", item.lopDays]].map(([k, v]) => (
            <View key={k} style={s.cell}><Text style={s.label}>{k}</Text><Text>{v}</Text></View>
          ))}
        </View>
        <View style={s.cols}>
          <Lines title="Earnings" lines={item.earnings} total={item.gross} />
          <Lines title="Deductions" lines={item.deductions} total={item.totalDeductions} />
        </View>
        <View style={s.net}><Text>Net pay</Text><Text>AED {aed(item.net)}</Text></View>
        <Text style={s.foot}>This is a computer-generated payslip and does not require a signature.</Text>
      </Page>
    </Document>
  );
}
