"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { NAV } from "@/lib/nav";
import { useRole } from "@/components/role-context";
import { atLeast } from "@/lib/rbac";

export function SidebarNav() {
  const pathname = usePathname();
  const role = useRole();

  return (
    <nav className="flex flex-col gap-1">
      {NAV.filter((item) => !item.minRole || atLeast(role, item.minRole)).map(
        (item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-surface-2 text-foreground font-medium"
                  : "text-muted hover:text-foreground hover:bg-surface-2",
              )}
            >
              {item.label}
            </Link>
          );
        },
      )}
    </nav>
  );
}
