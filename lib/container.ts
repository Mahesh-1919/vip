/** Pure container logic (no DB): ISO 6346 validation, status flow and landed-cost allocation. */
import Decimal from "decimal.js";

// ---------- ISO 6346 container number ----------
const LETTER_VALUES: Record<string, number> = {};
{
  let v = 10;
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") { if (v % 11 === 0) v++; LETTER_VALUES[ch] = v++; }
}

/** Check digit for the first 10 characters (owner code + category + serial). */
export function iso6346CheckDigit(first10: string): number {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = first10[i];
    const v = /[A-Z]/.test(c) ? LETTER_VALUES[c] : Number(c);
    sum += v * 2 ** i;
  }
  return (sum % 11) % 10;
}

export function normalizeContainerNo(raw: string) {
  return raw.toUpperCase().replace(/[\s-]/g, "");
}

export function validateContainerNo(raw: string): string | null {
  const n = normalizeContainerNo(raw);
  if (!/^[A-Z]{3}[UJZR]\d{7}$/.test(n)) return "Container number must be 4 letters (ending U, J, Z or R) followed by 7 digits, e.g. CSQU3054383";
  return iso6346CheckDigit(n.slice(0, 10)) === Number(n[10]) ? null : "Invalid container number: the check digit does not match";
}

// ---------- Status flow ----------
export type Direction = "inward" | "outward";
export const FLOW: Record<Direction, string[]> = {
  inward: ["in_transit", "at_port", "cleared", "received"],
  outward: ["packing", "dispatched", "shipped", "delivered"],
};
export const INITIAL_STATUS: Record<Direction, string> = { inward: "in_transit", outward: "packing" };
/** The status at which stock is posted. */
export const POSTING_STATUS: Record<Direction, string> = { inward: "received", outward: "dispatched" };

/** Forward-only. `cancelled` is possible until stock has been posted. */
export function allowedNext(direction: Direction, current: string, stockPosted: boolean): string[] {
  if (current === "cancelled") return [];
  const flow = FLOW[direction];
  const i = flow.indexOf(current);
  if (i < 0) return [];
  const out = flow.slice(i + 1);
  if (!stockPosted) out.push("cancelled");
  return out;
}

// ---------- Landed cost allocation ----------
export type AllocItem = { id: string; qty: Decimal.Value; valueAed: Decimal.Value; weightKg: Decimal.Value; volumeCbm: Decimal.Value };
export type AllocCost = { id: string; amountAed: Decimal.Value; basis: "value" | "quantity" | "weight" | "volume" };

/**
 * Spreads each cost over the items by its basis. Amounts are split in whole cents using the
 * largest-remainder method, so the allocated total for every cost equals the cost exactly.
 * If a basis has no usable weights (e.g. no weights entered) it falls back to value, then quantity.
 */
export function allocateCosts(items: AllocItem[], costs: AllocCost[]) {
  const perItem = new Map<string, Decimal>(items.map((i) => [i.id, new Decimal(0)]));
  const warnings: string[] = [];
  const weightOf = (i: AllocItem, basis: AllocCost["basis"]) =>
    new Decimal(basis === "value" ? i.valueAed : basis === "quantity" ? i.qty : basis === "weight" ? i.weightKg : i.volumeCbm);

  for (const c of costs) {
    let basis = c.basis;
    const total = (b: AllocCost["basis"]) => items.reduce((s, i) => s.plus(weightOf(i, b)), new Decimal(0));
    for (const fb of [basis, "value", "quantity"] as const) {
      if (total(fb).gt(0)) { if (fb !== basis) warnings.push(`Cost ${c.id}: no ${basis} data, allocated by ${fb} instead`); basis = fb; break; }
    }
    const sum = total(basis);
    if (sum.lte(0) || !items.length) continue;
    const cents = new Decimal(c.amountAed).times(100).toDecimalPlaces(0);
    const shares = items.map((i) => {
      const raw = cents.times(weightOf(i, basis)).div(sum);
      return { id: i.id, floor: raw.floor(), frac: raw.minus(raw.floor()) };
    });
    let left = cents.minus(shares.reduce((s, x) => s.plus(x.floor), new Decimal(0))).toNumber();
    const order = [...shares].sort((a, b) => b.frac.comparedTo(a.frac));
    for (const s of order) if (left > 0) { s.floor = s.floor.plus(1); left--; }
    for (const s of shares) perItem.set(s.id, perItem.get(s.id)!.plus(s.floor.div(100)));
  }
  return { perItem, warnings };
}

/** Landed cost per base unit in AED (4 dp): (goods value + allocated costs) / qty. */
export function landedUnitCost(qty: Decimal.Value, valueAed: Decimal.Value, allocatedAed: Decimal.Value): Decimal {
  const q = new Decimal(qty);
  return q.lte(0) ? new Decimal(0) : new Decimal(valueAed).plus(allocatedAed).div(q).toDecimalPlaces(4);
}
