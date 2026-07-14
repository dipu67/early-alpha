"use client";

import { useRouter } from "next/navigation";
import { Search, LogOut, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { CommandMenu } from "@/components/command-menu";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { MobileNav } from "@/components/mobile-nav";

export function TopBar({ email, role }: { email: string; role: string }) {
  const router = useRouter();
  const initials = email.slice(0, 2).toUpperCase();

  function openSearch() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="z-30 flex h-14 min-h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3 sm:gap-3 sm:px-4 pt-[env(safe-area-inset-top)]">
      <MobileNav />
      <div className="min-w-0 flex-1">
        <Breadcrumbs />
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0 sm:hidden"
        onClick={openSearch}
        aria-label="Search"
      >
        <Search className="size-5" />
      </Button>

      <button
        type="button"
        onClick={openSearch}
        className="hidden items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted sm:flex"
      >
        <Search className="size-4" />
        <span>Search…</span>
        <kbd className="ml-2 rounded bg-border px-1.5 text-xs">⌘K</kbd>
      </button>

      <ThemeToggle />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="outline-none shrink-0" aria-label="Account menu">
            <Avatar>
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="truncate text-sm font-medium text-foreground">{email}</div>
            <Badge variant="muted" className="mt-1">
              {role}
            </Badge>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => router.push("/dashboard/settings")}>
            <SettingsIcon /> Settings
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={logout}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CommandMenu />
    </header>
  );
}
