/**
 * Pure payroll calculation (no DB, no I/O) so every rule is unit-tested.
 * Money uses decimal.js and is rounded to 2 dp per line.
 */
import Decimal from "decimal.js";

export type Rules = {
  dayBasis: "30" | "calendar" | "working";
  lateMode: "none" | "every_n_half_day";
  lateEveryN: number;
};

export type StructureLine = { name: string; type: "allowance" | "deduction"; calc: "fixed" | "percent_of_basic"; value: string };
export type Adjustment = { label: string; type: "earning" | "deduction"; amount: string };

export type CalcInput = {
  rules: Rules;
  daysInMonth: number;
  workingDaysInMonth: number;
  basic: string;
  lines: StructureLine[];
  /** Attendance-driven (manual entries only; leave rows are handled separately). */
  absentDays: number;
  halfDays: number;
  lateCount: number;
  /** Days of unpaid leave in the month (half-day = 0.5). */
  unpaidLeaveDays: number;
  /** Unpaid-equivalent days from tiered leave (e.g. sick leave at 50% pay counts 0.5 per day). */
  tieredLeaveLopDays: number;
  /** Days in the month the employee was not employed (before joining / after exit). */
  unemployedDays: number;
  adjustments: Adjustment[];
};

export type CalcLine = { name: string; amount: string; note?: string };
export type CalcResult = {
  basisDays: number;
  lopDays: number;
  paidDays: number;
  dailyRate: string;
  earnings: CalcLine[];
  deductions: CalcLine[];
  gross: string;
  totalDeductions: string;
  net: string;
  warnings: string[];
};

const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const fx = (d: Decimal) => r2(d).toFixed(2);

export function basisDaysFor(rules: Rules, daysInMonth: number, workingDays: number) {
  return rules.dayBasis === "30" ? 30 : rules.dayBasis === "calendar" ? daysInMonth : workingDays;
}

export function calculatePayroll(i: CalcInput): CalcResult {
  const warnings: string[] = [];
  const basic = new Decimal(i.basic);
  const amountOf = (l: StructureLine) => (l.calc === "percent_of_basic" ? r2(basic.times(l.value).div(100)) : r2(new Decimal(l.value)));

  const earnings: CalcLine[] = [{ name: "Basic salary", amount: fx(basic) }];
  const deductions: CalcLine[] = [];
  let gross = basic;
  for (const l of i.lines.filter((x) => x.type === "allowance")) {
    const a = amountOf(l);
    if (a.isZero()) continue;
    earnings.push({ name: l.name, amount: fx(a), note: l.calc === "percent_of_basic" ? `${l.value}% of basic` : undefined });
    gross = gross.plus(a);
  }
  const monthlyGross = gross; // the contractual monthly pay that LOP is calculated against

  const basisDays = basisDaysFor(i.rules, i.daysInMonth, i.workingDaysInMonth);
  if (basisDays <= 0) warnings.push("Day basis is zero: no working days in this month");

  // Loss-of-pay days
  const lateDeductionDays = i.rules.lateMode === "every_n_half_day" && i.rules.lateEveryN > 0 ? Math.floor(i.lateCount / i.rules.lateEveryN) * 0.5 : 0;
  const parts = {
    absent: i.absentDays, half: i.halfDays * 0.5, unpaidLeave: i.unpaidLeaveDays, tiered: i.tieredLeaveLopDays,
    late: lateDeductionDays, unemployed: i.unemployedDays,
  };
  const rawLop = Object.values(parts).reduce((s, v) => s + v, 0);
  const lopDays = Math.min(basisDays, Math.round(rawLop * 100) / 100);
  if (rawLop > basisDays) warnings.push(`Loss of pay (${rawLop} days) exceeds the pay basis; capped at ${basisDays}`);

  const dailyRate = basisDays > 0 ? monthlyGross.div(basisDays) : new Decimal(0);
  const lopAmount = r2(dailyRate.times(lopDays));
  const explain = (): string => {
    const bits: string[] = [];
    if (parts.absent) bits.push(`${parts.absent} absent`);
    if (parts.half) bits.push(`${i.halfDays} half-day(s)`);
    if (parts.unpaidLeave) bits.push(`${parts.unpaidLeave} unpaid leave`);
    if (parts.tiered) bits.push(`${parts.tiered} reduced-pay leave`);
    if (parts.late) bits.push(`${i.lateCount} lates`);
    if (parts.unemployed) bits.push(`${parts.unemployed} not employed`);
    return bits.join(", ");
  };
  let totalDeductions = new Decimal(0);
  if (lopAmount.gt(0)) {
    deductions.push({ name: "Loss of pay", amount: fx(lopAmount), note: `${lopDays} day(s): ${explain()}` });
    totalDeductions = totalDeductions.plus(lopAmount);
  }

  for (const l of i.lines.filter((x) => x.type === "deduction")) {
    const a = amountOf(l);
    if (a.isZero()) continue;
    deductions.push({ name: l.name, amount: fx(a), note: l.calc === "percent_of_basic" ? `${l.value}% of basic` : undefined });
    totalDeductions = totalDeductions.plus(a);
  }

  for (const a of i.adjustments) {
    const amt = r2(new Decimal(a.amount));
    if (a.type === "earning") { earnings.push({ name: a.label, amount: fx(amt), note: "adjustment" }); gross = gross.plus(amt); }
    else { deductions.push({ name: a.label, amount: fx(amt), note: "adjustment" }); totalDeductions = totalDeductions.plus(amt); }
  }

  const net = gross.minus(totalDeductions);
  if (net.isNegative()) { warnings.push("Deductions exceed earnings (negative net pay)"); }
  return {
    basisDays, lopDays, paidDays: Math.round((basisDays - lopDays) * 100) / 100, dailyRate: fx(dailyRate),
    earnings, deductions, gross: fx(gross), totalDeductions: fx(totalDeductions), net: fx(net), warnings,
  };
}
