const SENSITIVE = /password|secret|token|hash|iban|account_?no|passport|emirates/i;

/** Redacts secrets so they never reach the log. */
export function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, SENSITIVE.test(k) ? "[redacted]" : redact(val)]),
    );
  }
  return v;
}

