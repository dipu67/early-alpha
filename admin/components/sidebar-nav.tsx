"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/dashboard/signals", label: "Signals" },
  { href: "/dashboard/projects", label: "Projects & Tags" },
  { href: "/dashboard/lists", label: "Lists" },
  { href: "/dashboard/watchlist", label: "Watchlist" },
  { href: "/dashboard/auth-accounts", label: "Auth Pool" },
];

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
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
      })}
    </nav>
  );
}
