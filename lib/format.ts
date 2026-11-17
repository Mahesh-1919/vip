const q = new Intl.NumberFormat("en-AE", { maximumFractionDigits: 4 });
export const formatQty = (v: string | number | null | undefined) => q.format(Number(v ?? 0));
