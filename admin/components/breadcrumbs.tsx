"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { SEGMENT_LABELS } from "@/lib/nav";

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean); // e.g. ["dashboard","projects"]

  const crumbs = segments.map((seg, i) => ({
    label: SEGMENT_LABELS[seg] ?? seg,
    href: "/" + segments.slice(0, i + 1).join("/"),
    last: i === segments.length - 1,
  }));

  // On very narrow screens only show the last crumb (page title).
  const mobileLast = crumbs[crumbs.length - 1];

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      {/* Mobile: current page only */}
      <div className="truncate text-sm font-medium text-foreground sm:hidden">
        {mobileLast?.label ?? "Dashboard"}
      </div>

      {/* sm+: full trail */}
      <div className="hidden items-center gap-1.5 text-sm sm:flex">
        {crumbs.map((c) => (
          <Fragment key={c.href}>
            {c.last ? (
              <span className="truncate font-medium text-foreground">{c.label}</span>
            ) : (
              <Link
                href={c.href}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                {c.label}
              </Link>
            )}
            {!c.last && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
          </Fragment>
        ))}
      </div>
    </nav>
  );
}
