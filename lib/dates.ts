/** Dates are stored as ISO strings (YYYY-MM-DD) and displayed DD/MM/YYYY. */
export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const s = typeof iso === "string" ? iso.slice(0, 10) : iso.toISOString().slice(0, 10);
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

export const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(todayISO() + "T00:00:00Z")) / 86_400_000);
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 15/Apr/2024: the register style used on the employee list. */
export function formatDateMon(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${MON[Number(m) - 1]}/${y}`;
}
/** 3-Jan-26: the style used in the free-zone bill sheets. */
export function formatSheetDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)}-${MON[Number(m) - 1]}-${y.slice(2)}`;
}
