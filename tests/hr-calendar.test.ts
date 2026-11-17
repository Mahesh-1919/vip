import { describe, expect, it } from "vitest";
import { accrued, eachDate, minutesLate, monthRange, monthsBetween, splitByTiers, weekday, workingDates } from "@/lib/hr-calendar";

describe("calendar maths", () => {
  it("knows weekdays and month ranges", () => {
    expect(weekday("2026-11-15")).toBe(0); // Sunday
    expect(monthRange(2026, 2)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(eachDate("2026-12-30", "2027-01-02")).toHaveLength(4);
  });
  it("excludes weekly offs and holidays from leave days", () => {
    const off = (d: string) => [0, 6].includes(weekday(d)) || d === "2026-12-02";
    // Mon 30 Nov .. Fri 4 Dec, with 2 Dec a holiday => 4 working days
    expect(workingDates("2026-11-30", "2026-12-04", off)).toHaveLength(4);
    // spanning a weekend
    expect(workingDates("2026-11-27", "2026-11-30", off)).toEqual(["2026-11-27", "2026-11-30"]);
  });
  it("accrues monthly", () => {
    expect(accrued(30, "monthly", 2026, "2026-06-15").toNumber()).toBe(15);
    expect(accrued(30, "monthly", 2026, "2027-01-01").toNumber()).toBe(30);
    expect(accrued(30, "monthly", 2027, "2026-06-15").toNumber()).toBe(0);
    expect(accrued(5, "annual_upfront", 2026, "2026-01-01").toNumber()).toBe(5);
  });
  it("counts completed service months", () => {
    expect(monthsBetween("2026-01-15", "2026-07-14")).toBe(5);
    expect(monthsBetween("2026-01-15", "2026-07-15")).toBe(6);
  });
  it("splits UAE sick leave across pay tiers", () => {
    const tiers = [{ upToDays: 15, payPercent: 100 }, { upToDays: 45, payPercent: 50 }, { upToDays: 90, payPercent: 0 }];
    expect(splitByTiers(0, 10, tiers)).toEqual([{ payPercent: 100, days: 10 }]);
    expect(splitByTiers(12, 6, tiers)).toEqual([{ payPercent: 100, days: 3 }, { payPercent: 50, days: 3 }]);
    expect(splitByTiers(44, 3, tiers)).toEqual([{ payPercent: 50, days: 1 }, { payPercent: 0, days: 2 }]);
  });
  it("computes lateness after grace", () => {
    expect(minutesLate("09:10", "09:00", 15)).toBe(0);
    expect(minutesLate("09:40:00", "09:00:00", 15)).toBe(25);
  });
});
