"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, startTransition, useState } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, Plane, Wallet, FileText, Clock, CalendarDays, Settings, Settings2,
  UserCog, ScrollText, Building2, PackagePlus, PackageMinus, Route, ShoppingCart, ReceiptText, Contact, ChevronDown, ShieldCheck, LogOut, type LucideIcon,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";

const ICONS: Record<string, LucideIcon> = { LayoutDashboard, Users, CalendarCheck, Plane, Wallet, FileText, Clock, CalendarDays, Settings, Settings2, UserCog, ScrollText, Building2, PackagePlus, PackageMinus, Route, ShoppingCart, ReceiptText, Contact };
type Section = { title: string; items: { label: string; href: string; icon: string }[] };

const LABELS: Record<string, string> = { hr: "HR", freezone: "Bills", sales: "Sales", admin: "Administration", config: "Settings", new: "New", sif: "SIF" };
const isId = (s: string) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(s);
const pretty = (s: string) => LABELS[s] ?? s.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Closes the mobile drawer after navigating. */
function CloseOnNavigate({ pathname }: { pathname: string }) {
  const { setOpenMobile } = useSidebar();
  const [last, setLast] = useState(pathname);
  if (last !== pathname) { setLast(pathname); setOpenMobile(false); }
  return null;
}

export function AppFrame({ appName, companyName, sections, user, logout, children }: {
  appName: string; companyName: string;
  sections: Section[];
  user: { name: string; role: string; email: string };
  logout: () => Promise<void>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const all = sections.flatMap((s) => s.items);
  const active = all.filter((i) => (i.href === "/" ? pathname === "/" : pathname === i.href || pathname.startsWith(i.href + "/")))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const segs = pathname.split("/").filter(Boolean).filter((s) => !isId(s));
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <SidebarProvider>
      <CloseOnNavigate pathname={pathname} />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">Skip to content</a>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu><SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/"><BrandLogo size={34} /><span className="grid min-w-0 leading-tight"><span className="truncate text-base font-semibold text-foreground">{appName}</span><span className="truncate text-xs font-normal text-sidebar-foreground/70">{companyName}</span></span></Link>
            </SidebarMenuButton>
          </SidebarMenuItem></SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          {sections.map((s) => (
            <Collapsible key={s.title} defaultOpen className="group/collapsible">
              <SidebarGroup>
                {s.title !== "Overview" && (
                  <SidebarGroupLabel asChild className="text-xs font-semibold uppercase tracking-wider">
                    <CollapsibleTrigger>{s.title}<ChevronDown className="ml-auto size-3 transition-transform group-data-[state=closed]/collapsible:-rotate-90" /></CollapsibleTrigger>
                  </SidebarGroupLabel>
                )}
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {s.items.map((i) => {
                        const Icon = ICONS[i.icon] ?? Settings;
                        return (
                          <SidebarMenuItem key={i.href}>
                            <SidebarMenuButton asChild isActive={active === i.href} tooltip={i.label}>
                              <Link href={i.href}><Icon /><span>{i.label}</span></Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          ))}
        </SidebarContent>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 bg-background/85 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
                    <Breadcrumb className="min-w-0 flex-1">
            <BreadcrumbList className="flex-nowrap">
              {segs.length === 0 ? <BreadcrumbItem><BreadcrumbPage>Dashboard</BreadcrumbPage></BreadcrumbItem> : segs.map((s, i) => (
                <Fragment key={i}>
                  {i > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem className="truncate">
                    {i === segs.length - 1 ? <BreadcrumbPage>{pretty(s)}</BreadcrumbPage> : <span className="text-muted-foreground">{pretty(s)}</span>}
                  </BreadcrumbItem>
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 rounded-full bg-card py-1.5 pr-4 pl-1.5 shadow-xs outline-none hover:bg-card/80 focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar className="size-8"><AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">{initials}</AvatarFallback></Avatar>
              <span className="hidden text-left leading-tight sm:block"><span className="block text-sm font-medium">{user.name}</span><span className="block text-xs text-muted-foreground">{user.role}</span></span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal text-xs text-muted-foreground">{user.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild><Link href="/account/security"><ShieldCheck /> Security</Link></DropdownMenuItem>
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); startTransition(() => { void logout(); }); }}><LogOut /> Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main id="main" className="mx-auto w-full max-w-[110rem] flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
