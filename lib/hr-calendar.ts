/** Pure date/leave maths (no DB) so it is unit-testable. Dates are ISO 'YYYY-MM-DD', treated as UTC days. */
import Decimal from "decimal.js";

const DAY = 86_400_000;
export const toMs = (iso: string) => Date.parse(iso + "T00:00:00Z");
export const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const weekday = (iso: string) => new Date(toMs(iso)).getUTCDay(); // 0 = Sunday

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = toMs(from); t <= toMs(to); t += DAY) out.push(fromMs(t));
  return out;
}

export function monthRange(year: number, month: number) {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = fromMs(Date.UTC(year, month, 0));
  return { from, to };
}

/** Dates in [from, to] that are neither weekly off nor holiday. */
export function workingDates(from: string, to: string, isOff: (d: string) => boolean): string[] {
  return eachDate(from, to).filter((d) => !isOff(d));
}

/** Entitlement available so far this year. Monthly accrual releases 1/12 per month elapsed. */
export function accrued(allocated: Decimal.Value, mode: "annual_upfront" | "monthly", year: number, asOf: string): Decimal {
  const a = new Decimal(allocated);
  if (mode === "annual_upfront") return a;
  const asYear = Number(asOf.slice(0, 4));
  const months = asYear > year ? 12 : asYear < year ? 0 : Number(asOf.slice(5, 7));
  return a.times(months).div(12).toDecimalPlaces(2);
}

export function monthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}

/**
 * Splits `days` of leave across cumulative pay tiers, given days already taken this year.
 * UAE sick leave: first 15 days full pay, next 30 half pay, next 45 unpaid.
 */
export function splitByTiers(alreadyUsed: number, days: number, tiers: { upToDays: number; payPercent: number }[]) {
  const sorted = [...tiers].sort((a, b) => a.upToDays - b.upToDays);
  const out: { payPercent: number; days: number }[] = [];
  let cursor = alreadyUsed;
  let remaining = days;
  for (const t of sorted) {
    if (remaining <= 0) break;
    if (cursor >= t.upToDays) continue;
    const take = Math.min(remaining, t.upToDays - cursor);
    out.push({ payPercent: t.payPercent, days: take });
    cursor += take;
    remaining -= take;
  }
  if (remaining > 0) out.push({ payPercent: 0, days: remaining });
  return out;
}

/** Minutes late versus shift start + grace (0 if on time). Times are 'HH:MM[:SS]'. */
export function minutesLate(checkIn: string, shiftStart: string, graceMinutes: number): number {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return Math.max(0, m(checkIn) - m(shiftStart) - graceMinutes);
}
