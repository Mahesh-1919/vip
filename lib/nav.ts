import type { Permission } from "./rbac";

export type NavItem = { label: string; href: string; permission: Permission; icon: string };
export type NavSection = { title: string; items: NavItem[] };

/** Add entries here as each phase ships. Items are hidden if the user lacks the permission
 *  (the routes/APIs enforce it independently). `icon` is a lucide icon name (see components/app-frame.tsx). */
export const NAV: NavSection[] = [
  { title: "Overview", items: [{ label: "Dashboard", href: "/", permission: "dashboard:view", icon: "LayoutDashboard" }] },
  {
    title: "HR",
    items: [
      { label: "Employees", href: "/hr/employees", permission: "hr:employee:read", icon: "Users" },
      { label: "Attendance", href: "/hr/attendance", permission: "hr:attendance:read", icon: "CalendarCheck" },
      { label: "Leave", href: "/hr/leave", permission: "hr:leave:read", icon: "Plane" },
      { label: "Payroll", href: "/hr/payroll", permission: "hr:payroll:read", icon: "Wallet" },
      { label: "Payslips", href: "/hr/payslips", permission: "hr:payslip:read", icon: "FileText" },
      { label: "Shifts", href: "/hr/shifts", permission: "hr:config:read", icon: "Clock" },
      { label: "Holiday calendars", href: "/hr/holidays", permission: "hr:config:read", icon: "CalendarDays" },
      { label: "HR settings", href: "/hr/config", permission: "hr:config:read", icon: "Settings" },
    ],
  },
  {
    title: "Inventory",
    items: [
      { label: "Products", href: "/inventory/products", permission: "inventory:product:read", icon: "Package" },
      { label: "Containers", href: "/inventory/containers", permission: "inventory:container:read", icon: "Container" },
      { label: "Invoices", href: "/inventory/invoices", permission: "inventory:invoice:read", icon: "ReceiptText" },
      { label: "Stock", href: "/inventory/stock", permission: "inventory:stock:read", icon: "Boxes" },
      { label: "Suppliers", href: "/inventory/suppliers", permission: "inventory:supplier:read", icon: "Truck" },
      { label: "Customers", href: "/inventory/customers", permission: "inventory:customer:read", icon: "Contact" },
      { label: "Inventory settings", href: "/inventory/config", permission: "inventory:product:read", icon: "Settings2" },
    ],
  },
  {
    title: "Sales",
    items: [
      { label: "Sales", href: "/sales", permission: "sales:sale:read", icon: "ShoppingCart" },
      { label: "Expenses", href: "/sales/expenses", permission: "sales:expense:read", icon: "Receipt" },
      { label: "Container P&L", href: "/sales/containers", permission: "sales:report:read", icon: "TrendingUp" },
      { label: "Reports", href: "/sales/reports", permission: "sales:report:read", icon: "BarChart3" },
    ],
  },
  {
    title: "Accounting",
    items: [
      { label: "Overview", href: "/accounting", permission: "accounting:report:read", icon: "Landmark" },
      { label: "Journal", href: "/accounting/journal", permission: "accounting:journal:read", icon: "BookOpen" },
      { label: "General ledger", href: "/accounting/ledger", permission: "accounting:journal:read", icon: "Library" },
      { label: "Receivables", href: "/accounting/receivables", permission: "accounting:receivable:read", icon: "ArrowDownToLine" },
      { label: "Payables", href: "/accounting/payables", permission: "accounting:payable:read", icon: "ArrowUpFromLine" },
      { label: "Reports", href: "/accounting/reports", permission: "accounting:report:read", icon: "FileBarChart" },
      { label: "Chart of accounts", href: "/accounting/accounts", permission: "accounting:account:read", icon: "ListTree" },
    ],
  },
  {
    title: "Administration",
    items: [
      { label: "Users", href: "/admin/users", permission: "admin:user:read", icon: "UserCog" },
      { label: "Company settings", href: "/admin/settings", permission: "admin:settings:read", icon: "Building2" },
      { label: "Audit log", href: "/admin/audit-log", permission: "admin:audit:read", icon: "ScrollText" },
    ],
  },
];
