const cell = (v: unknown) => {
  const s = String(v ?? "");
  // Guard against spreadsheet formula injection from user-entered text.
  const safe = /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** UTF-8 CSV with a BOM so Excel opens it correctly. */
export function toCsv(headers: string[], rows: (string | number | null)[][]) {
  return "﻿" + [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
