import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });
export { Decimal };

export const D = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
/** Round to 2 dp for storage (numeric(14,2)). */
export const toDb = (v: Decimal.Value) => D(v).toDecimalPlaces(2).toFixed(2);

const fmt = new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", currencyDisplay: "code" });
export const formatAED = (v: Decimal.Value | null | undefined) => fmt.format(D(v).toNumber());
