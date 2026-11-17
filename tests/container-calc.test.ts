import { describe, expect, it } from "vitest";
import { allocateCosts, allowedNext, iso6346CheckDigit, landedUnitCost, validateContainerNo } from "@/lib/container";

describe("ISO 6346", () => {
  it("accepts a valid number and rejects a wrong check digit or format", () => {
    expect(validateContainerNo("CSQU3054383")).toBeNull();
    expect(validateContainerNo("csqu 305438-3")).toBeNull();
    expect(validateContainerNo("CSQU3054384")).toMatch(/check digit/);
    expect(validateContainerNo("CSQ3054383")).toMatch(/4 letters/);
    expect(validateContainerNo("CSQX3054383")).toMatch(/4 letters/); // category letter must be U/J/Z/R
  });
  it("computes the check digit", () => expect(iso6346CheckDigit("CSQU305438")).toBe(3));
});

describe("status flow", () => {
  it("is forward-only and allows cancelling only before stock is posted", () => {
    expect(allowedNext("inward", "in_transit", false)).toEqual(["at_port", "cleared", "received", "cancelled"]);
    expect(allowedNext("inward", "cleared", false)).toEqual(["received", "cancelled"]);
    expect(allowedNext("inward", "received", true)).toEqual([]);
    expect(allowedNext("outward", "packing", false)).toEqual(["dispatched", "shipped", "delivered", "cancelled"]);
    expect(allowedNext("outward", "shipped", true)).toEqual(["delivered"]);
    expect(allowedNext("inward", "cancelled", false)).toEqual([]);
  });
});

describe("landed cost allocation", () => {
  const items = [
    { id: "a", qty: 100, valueAed: 10000, weightKg: 500, volumeCbm: 2 },
    { id: "b", qty: 300, valueAed: 30000, weightKg: 1500, volumeCbm: 6 },
  ];
  it("splits by value, quantity, weight and volume", () => {
    const r = allocateCosts(items, [
      { id: "freight", amountAed: 4000, basis: "weight" },
      { id: "duty", amountAed: 2000, basis: "value" },
    ]);
    expect(r.perItem.get("a")!.toNumber()).toBe(1500); // 1000 + 500
    expect(r.perItem.get("b")!.toNumber()).toBe(4500); // 3000 + 1500
  });
  it("always distributes the exact amount (largest remainder, whole cents)", () => {
    const three = [1, 2, 3].map((n) => ({ id: String(n), qty: 1, valueAed: 100, weightKg: 0, volumeCbm: 0 }));
    const r = allocateCosts(three, [{ id: "c", amountAed: 100, basis: "quantity" }]);
    const parts = [...r.perItem.values()].map((d) => d.toNumber());
    expect(parts.reduce((s, x) => s + x, 0)).toBeCloseTo(100, 10);
    expect(parts.sort()).toEqual([33.33, 33.33, 33.34]);
  });
  it("falls back when the chosen basis has no data", () => {
    const noWeights = items.map((i) => ({ ...i, weightKg: 0 }));
    const r = allocateCosts(noWeights, [{ id: "f", amountAed: 400, basis: "weight" }]);
    expect(r.warnings[0]).toMatch(/allocated by value/);
    expect(r.perItem.get("a")!.toNumber()).toBe(100);
  });
  it("computes landed unit cost", () => {
    expect(landedUnitCost(100, 10000, 1500).toNumber()).toBe(115);
    expect(landedUnitCost(3, 100, 0).toNumber()).toBe(33.3333);
  });
});
