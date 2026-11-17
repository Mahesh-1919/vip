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
  // Inventory / containers / invoicing
  "inventory:product:read", "inventory:product:write",
  "inventory:stock:read", "inventory:stock:adjust",
  "inventory:container:read", "inventory:container:write",
  "inventory:customer:read", "inventory:customer:write",
  "inventory:supplier:read", "inventory:supplier:write",
  "inventory:invoice:read", "inventory:invoice:write",
  "inventory:payment:read", "inventory:payment:write",
  // Sales & expenses
  "sales:sale:read", "sales:sale:write",
  "sales:expense:read", "sales:expense:write",
  "sales:report:read",
  // Accounting
  "accounting:account:read", "accounting:account:write",
  "accounting:journal:read", "accounting:journal:write",
  "accounting:receivable:read",
  "accounting:payable:read", "accounting:payable:write",
  "accounting:report:read",
  "accounting:tax:read",
  "accounting:payroll-summary:read",
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
  {
    key: "hr_manager", name: "HR Manager", description: "HRMS module only",
    permissions: ["dashboard:view", ...by("hr:")],
  },
  {
    key: "inventory_manager", name: "Inventory Manager",
    description: "Stock, containers, customers, suppliers, bills and invoices",
    permissions: ["dashboard:view", ...by("inventory:")],
  },
  {
    key: "sales_manager", name: "Sales Manager",
    description: "Sales and expenses; read-only view of containers and stock",
    permissions: [
      "dashboard:view",
      ...by("sales:"),
      "inventory:container:read", "inventory:stock:read", "inventory:product:read", "inventory:customer:read",
    ],
  },
  {
    key: "accountant", name: "Accountant",
    description: "Accounting module; read access to sales, invoices and payroll totals",
    permissions: [
      "dashboard:view",
      ...by("accounting:"),
      "sales:sale:read", "sales:expense:read", "sales:report:read",
      "inventory:invoice:read", "inventory:payment:read", "inventory:customer:read", "inventory:supplier:read",
    ],
  },
];
