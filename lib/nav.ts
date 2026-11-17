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
    title: "Free Zone",
    items: [
      { label: "Entry bills", href: "/freezone/entries", permission: "freezone:entry:read", icon: "PackagePlus" },
      { label: "Exit bills", href: "/freezone/exits", permission: "freezone:exit:read", icon: "PackageMinus" },
      { label: "Shipment trace", href: "/freezone/trace", permission: "freezone:exit:read", icon: "Route" },
    ],
  },
  {
    title: "Sales",
    items: [
      { label: "Sales", href: "/sales", permission: "sales:sale:read", icon: "ShoppingCart" },
      { label: "Invoices", href: "/sales/invoices", permission: "sales:invoice:read", icon: "ReceiptText" },
      { label: "Customers", href: "/sales/customers", permission: "sales:customer:read", icon: "Contact" },
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
