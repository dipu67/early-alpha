"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { NAV } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { useRole } from "@/components/role-context";
import { atLeast } from "@/lib/rbac";

const KEY = "ea_sidebar_collapsed";

export function AppSidebar() {
  const pathname = usePathname();
  const role = useRole();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(KEY) === "1");
  }, []);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <aside
      className={cn(
        // Fixed-height column inside the h-dvh shell — never scrolls with page content.
        "hidden h-full min-h-0 shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] md:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 px-4 py-4",
          collapsed && "justify-center px-2",
        )}
      >
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold tracking-tight">early alpha</div>
            <div className="text-xs text-muted-foreground">admin console</div>
          </div>
        )}
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle sidebar">
          {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
        </Button>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-y-contain px-2 pb-4">
        {NAV.filter((item) => !item.minRole || atLeast(role, item.minRole)).map((item) => {
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                collapsed && "justify-center px-0",
                active
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
