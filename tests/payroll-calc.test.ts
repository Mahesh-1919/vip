import { describe, expect, it } from "vitest";
import { calculatePayroll, type CalcInput } from "@/lib/payroll-calc";

const base: CalcInput = {
  rules: { dayBasis: "30", lateMode: "none", lateEveryN: 3 },
  daysInMonth: 31, workingDaysInMonth: 21, basic: "6000",
  lines: [
    { name: "Housing", type: "allowance", calc: "percent_of_basic", value: "25" },
    { name: "Transport", type: "allowance", calc: "fixed", value: "600" },
    { name: "Advance recovery", type: "deduction", calc: "fixed", value: "200" },
  ],
  absentDays: 0, halfDays: 0, lateCount: 0, unpaidLeaveDays: 0, tieredLeaveLopDays: 0, unemployedDays: 0, adjustments: [],
};

describe("payroll calculation", () => {
  it("full month: basic + allowances − deductions", () => {
    const r = calculatePayroll(base);
    expect(r.gross).toBe("8100.00"); // 6000 + 1500 + 600
    expect(r.totalDeductions).toBe("200.00");
    expect(r.net).toBe("7900.00");
    expect(r.lopDays).toBe(0);
    expect(r.paidDays).toBe(30);
  });

  it("deducts loss of pay at gross/30 per day", () => {
    const r = calculatePayroll({ ...base, absentDays: 2, halfDays: 1, unpaidLeaveDays: 1 });
    expect(r.lopDays).toBe(3.5);
    // 8100/30 = 270/day × 3.5 = 945
    expect(r.deductions[0]).toMatchObject({ name: "Loss of pay", amount: "945.00" });
    expect(r.net).toBe("6955.00"); // 8100 − 945 − 200
  });

  it("supports calendar and working-day bases", () => {
    expect(calculatePayroll({ ...base, rules: { ...base.rules, dayBasis: "calendar" }, absentDays: 1 }).dailyRate).toBe("261.29");
    expect(calculatePayroll({ ...base, rules: { ...base.rules, dayBasis: "working" }, absentDays: 1 }).basisDays).toBe(21);
  });

  it("every N lates costs half a day (optional rule)", () => {
    const on = { ...base.rules, lateMode: "every_n_half_day" as const, lateEveryN: 3 };
    expect(calculatePayroll({ ...base, rules: on, lateCount: 7 }).lopDays).toBe(1); // floor(7/3)=2 × 0.5
    expect(calculatePayroll({ ...base, lateCount: 7 }).lopDays).toBe(0); // default: no late deduction
  });

  it("prorates for mid-month joiners and caps LOP at the basis", () => {
    expect(calculatePayroll({ ...base, unemployedDays: 10 }).lopDays).toBe(10);
    const r = calculatePayroll({ ...base, absentDays: 40 });
    expect(r.lopDays).toBe(30);
    expect(r.warnings.join()).toMatch(/capped/);
  });

  it("applies one-off adjustments and flags negative net", () => {
    const r = calculatePayroll({ ...base, adjustments: [{ label: "Bonus", type: "earning", amount: "500" }, { label: "Fine", type: "deduction", amount: "50.5" }] });
    expect(r.gross).toBe("8600.00");
    expect(r.net).toBe("8349.50");
    const neg = calculatePayroll({ ...base, adjustments: [{ label: "Recovery", type: "deduction", amount: "9000" }] });
    expect(neg.warnings.join()).toMatch(/negative/);
  });

  it("rounds half up to 2 dp without float drift", () => {
    const r = calculatePayroll({ ...base, basic: "1000.10", lines: [{ name: "X", type: "allowance", calc: "percent_of_basic", value: "33.33" }] });
    expect(r.earnings[1].amount).toBe("333.33");
    expect(r.gross).toBe("1333.43");
  });
});
