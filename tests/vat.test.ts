import { describe, expect, it } from "vitest";
import { defaultVatCategory, invoiceTotals, lineAmounts, paymentStatus, vatRateFor } from "@/lib/vat";

describe("UAE VAT", () => {
  it("5% standard, 0% otherwise", () => {
    expect([vatRateFor("standard"), vatRateFor("zero"), vatRateFor("exempt"), vatRateFor("out_of_scope")]).toEqual([5, 0, 0, 0]);
  });
  it("defaults to zero-rated for exports, standard for UAE customers", () => {
    expect(defaultVatCategory("AE")).toBe("standard");
    expect(defaultVatCategory("ae")).toBe("standard");
    expect(defaultVatCategory("KE")).toBe("zero");
    expect(defaultVatCategory(null)).toBe("standard");
  });
  it("rounds half up per line without float drift", () => {
    const a = lineAmounts("3", "33.335", 5); // net 100.005 -> 100.01, VAT 5.0005 -> 5.00
    expect(a.net.toString()).toBe("100.01");
    expect(a.vat.toString()).toBe("5");
    expect(lineAmounts("1", "0.1", 5).vat.toString()).toBe("0.01"); // 0.005 rounds half up
  });
  it("totals in document currency and AED (VAT shown in AED)", () => {
    const lines = [lineAmounts(10, "100", 5), lineAmounts(2, "250.50", 0)];
    const t = invoiceTotals(lines, "3.6725");
    expect(t.subtotal.toString()).toBe("1501");
    expect(t.vatTotal.toString()).toBe("50");
    expect(t.total.toString()).toBe("1551");
    expect(t.vatAed.toString()).toBe("183.63"); // 50 × 3.6725 = 183.625 -> 183.63
    expect(t.subtotalAed.toString()).toBe("5512.42"); // 1501 × 3.6725 = 5512.4225
  });
  it("derives payment status", () => {
    expect(paymentStatus("100", "0")).toBe("unpaid");
    expect(paymentStatus("100", "40")).toBe("partial");
    expect(paymentStatus("100", "100")).toBe("paid");
  });
});
