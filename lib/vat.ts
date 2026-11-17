/** UAE VAT maths (pure). Amounts rounded half-up to 2 dp, line by line. */
import Decimal from "decimal.js";

export const VAT_CATEGORIES = ["standard", "zero", "exempt", "out_of_scope"] as const;
export type VatCategory = (typeof VAT_CATEGORIES)[number];
export const VAT_STANDARD_RATE = 5;
export const VAT_LABEL: Record<VatCategory, string> = { standard: "Standard rated (5%)", zero: "Zero rated (0%)", exempt: "Exempt", out_of_scope: "Out of scope" };

export const vatRateFor = (cat: VatCategory) => (cat === "standard" ? VAT_STANDARD_RATE : 0);

/** Goods delivered to a customer in the UAE carry 5% VAT; exports outside the UAE are zero-rated. */
export function defaultVatCategory(customerCountry: string | null | undefined): VatCategory {
  return !customerCountry || customerCountry.toUpperCase() === "AE" ? "standard" : "zero";
}

const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function lineAmounts(qty: Decimal.Value, unitPrice: Decimal.Value, ratePercent: Decimal.Value) {
  const net = r2(new Decimal(qty).times(unitPrice));
  const vat = r2(net.times(ratePercent).div(100));
  return { net, vat, total: net.plus(vat) };
}

/** VAT on a net amount that is already exact (e.g. a partial bill of an export). */
export function amountsFromNet(net: Decimal.Value, ratePercent: Decimal.Value) {
  const n = r2(new Decimal(net));
  const vat = r2(n.times(ratePercent).div(100));
  return { net: n, vat, total: n.plus(vat) };
}

export function invoiceTotals(lines: { net: Decimal.Value; vat: Decimal.Value }[], exchangeRate: Decimal.Value) {
  const subtotal = lines.reduce((s, l) => s.plus(l.net), new Decimal(0));
  const vatTotal = lines.reduce((s, l) => s.plus(l.vat), new Decimal(0));
  const rate = new Decimal(exchangeRate);
  const subtotalAed = r2(subtotal.times(rate)), vatAed = r2(vatTotal.times(rate));
  return { subtotal, vatTotal, total: subtotal.plus(vatTotal), subtotalAed, vatAed, totalAed: subtotalAed.plus(vatAed) };
}

export function paymentStatus(total: Decimal.Value, paid: Decimal.Value): "unpaid" | "partial" | "paid" {
  const p = new Decimal(paid), t = new Decimal(total);
  return p.lte(0) ? "unpaid" : p.gte(t) ? "paid" : "partial";
}
