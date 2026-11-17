/**
 * Permission catalogue. Keys are `module:resource:action`.
 * Roles are rows in the DB (editable by Admin); DEFAULT_ROLES seeds the five system roles.
 */
export const PERMISSIONS = [
  "dashboard:view",
  // Admin
  "admin:user:read", "admin:user:write",
  "admin:role:read", "admin:role:write",
  "admin:audit:read",
  "admin:settings:read", "admin:settings:write",
  // HRMS
  "hr:employee:read", "hr:employee:write",
  "hr:employee:sensitive", // view full Emirates ID / passport / IBAN and salary
  "hr:salary:read", "hr:salary:write",
  "hr:attendance:read", "hr:attendance:write",
  "hr:leave:read", "hr:leave:write", "hr:leave:approve",
  "hr:payroll:read", "hr:payroll:write", "hr:payroll:finalize", "hr:payroll:export",
  "hr:payslip:read",
  "hr:config:read", "hr:config:write", // shifts, holiday calendars, leave policies, salary components
  // Free zone register
  "freezone:entry:read", "freezone:entry:write",
  "freezone:exit:read", "freezone:exit:write",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const all = [...PERMISSIONS] as Permission[];
const by = (prefix: string) => all.filter((p) => p.startsWith(prefix));

export const DEFAULT_ROLES: {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
}[] = [
  { key: "admin", name: "Admin", description: "Full access to all modules, users and settings", permissions: all },
  { key: "hr_manager", name: "HR Manager", description: "HRMS module only", permissions: ["dashboard:view", ...by("hr:")] },
  { key: "operations_manager", name: "Operations Manager", description: "Free zone entry and exit bills", permissions: ["dashboard:view", ...by("freezone:")] },
];
