"use client";

import { BarChart3, Building2, LayoutDashboard, Menu, Send, ShieldAlert, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Dialog, DialogTrigger, SheetContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ICONS = {
  overview: LayoutDashboard,
  clients: Building2,
  campaigns: Send,
  customers: Users,
  results: BarChart3,
  system: ShieldAlert,
} as const;

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  /** Exact match only (for index routes like /admin). */
  exact?: boolean;
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
              active ? "bg-subtle font-medium text-ink" : "text-ink-2 hover:bg-subtle hover:text-ink",
            )}
          >
            <Icon className={cn("size-4", active ? "text-accent" : "text-muted")} aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar({
  items,
  brand,
  footer,
}: {
  items: NavItem[];
  brand: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <aside className="sticky top-8 hidden h-[calc(100dvh-2rem)] w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
      <div className="px-4 pb-4 pt-5">{brand}</div>
      <div className="flex-1 px-2">
        <NavList items={items} />
      </div>
      {footer && <div className="border-t border-line px-4 py-3">{footer}</div>}
    </aside>
  );
}

export function MobileNav({
  items,
  brand,
  footer,
}: {
  items: NavItem[];
  brand: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  return (
    <div className="sticky top-8 z-20 flex h-12 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={t("openMenu")}
            className="-ml-1 rounded-md p-1.5 text-ink-2 hover:bg-subtle"
          >
            <Menu className="size-5" />
          </button>
        </DialogTrigger>
        <SheetContent title={t("menu")} className="flex flex-col">
          <div className="px-4 pb-4 pt-5">{brand}</div>
          <div className="flex-1 px-2">
            <NavList items={items} onNavigate={() => setOpen(false)} />
          </div>
          {footer && <div className="border-t border-line px-4 py-3">{footer}</div>}
        </SheetContent>
      </Dialog>
      <div className="min-w-0 truncate">{brand}</div>
    </div>
  );
}
