"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { proxy } from "@/lib/client";

interface Results {
  projects: { id: string; username: string; name: string }[];
  watches: { id: string; username: string }[];
  signals: { tweetId: string; username: string; slug: string }[];
}

export function CommandMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Results | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!q) {
      setResults(null);
      return;
    }
    const t = setTimeout(async () => {
      const res = await proxy(`/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) setResults(res.body as Results);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setQ("");
      window.open(href, "_blank");
    },
    [],
  );

  const goInternal = useCallback(
    (href: string) => {
      setOpen(false);
      setQ("");
      router.push(href);
    },
    [router],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search projects, watches, signals…" value={q} onValueChange={setQ} />
      <CommandList>
        {!results ? (
          <CommandEmpty>{q ? "Searching…" : "Type to search."}</CommandEmpty>
        ) : results.projects.length + results.watches.length + results.signals.length === 0 ? (
          <CommandEmpty>No results.</CommandEmpty>
        ) : null}

        {results && results.projects.length > 0 && (
          <CommandGroup heading="Projects">
            {results.projects.map((p) => (
              <CommandItem key={p.id} value={`project-${p.username}`} onSelect={() => goInternal(`/dashboard/projects?search=${p.username}`)}>
                @{p.username} <span className="text-muted-foreground">{p.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results && results.watches.length > 0 && (
          <CommandGroup heading="Watchlist">
            {results.watches.map((w) => (
              <CommandItem key={w.id} value={`watch-${w.username}`} onSelect={() => goInternal(`/dashboard/watchlist`)}>
                @{w.username}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results && results.signals.length > 0 && (
          <CommandGroup heading="Signals">
            {results.signals.map((s) => (
              <CommandItem
                key={s.tweetId}
                value={`signal-${s.tweetId}`}
                onSelect={() => go(`https://x.com/${s.username}/status/${s.tweetId}`)}
              >
                @{s.username} <span className="text-muted-foreground">· {s.slug}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
