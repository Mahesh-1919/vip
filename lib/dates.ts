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
