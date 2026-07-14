"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import type { ProjectTag } from "@/lib/types";

/** Popover tag editor — does not stretch the table row. */
export function ReclassifyControl({
  accountId,
  currentTags,
}: {
  accountId: string;
  currentTags: string[];
}) {
  const router = useRouter();
  const canWrite = useCan("editor");
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(currentTags);
  const [options, setOptions] = useState<{ slug: string; label: string }[]>([]);
  const [filter, setFilter] = useState("");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!canWrite || !open || loaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await proxy("/api/tags");
        if (cancelled) return;
        if (res.ok) {
          const body = res.body as { items: ProjectTag[] };
          const items = Array.isArray(body.items) ? body.items : [];
          setOptions(
            items
              .filter((t) => t.enabled !== false)
              .map((t) => ({ slug: t.slug, label: t.label || t.slug }))
              .sort((a, b) => a.label.localeCompare(b.label)),
          );
          setLoadError(null);
        } else {
          setLoadError(`Could not load tags (${res.status})`);
        }
      } catch {
        if (!cancelled) setLoadError("Could not load tags");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loaded, canWrite]);

  useEffect(() => {
    if (!open) setSelected(currentTags.map((t) => t.toLowerCase()));
  }, [currentTags, open]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.slug.includes(q) || o.label.toLowerCase().includes(q),
    );
  }, [options, filter]);

  if (!canWrite) return null;

  function toggle(slug: string) {
    const s = slug.trim().toLowerCase();
    if (!s) return;
    setSelected((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  function addCustom() {
    const parts = custom
      .split(/[,\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) return;
    setSelected((prev) => [...new Set([...prev, ...parts])]);
    setCustom("");
  }

  async function save() {
    const tags = [...new Set(selected.map((t) => t.trim().toLowerCase()).filter(Boolean))];
    if (tags.length === 0) {
      toast.error("Select at least one tag");
      return;
    }
    if (!accountId) {
      toast.error("Missing account id");
      return;
    }

    setBusy(true);
    try {
      const res = await proxy("/api/reclassify", {
        method: "POST",
        body: { accountId: String(accountId), tags },
      });
      if (res.ok) {
        const body = res.body as { tags?: string[] } | null;
        toast.success(
          body?.tags?.length ? `Tags set: ${body.tags.join(", ")}` : "Tags updated",
        );
        setOpen(false);
        setFilter("");
        setCustom("");
        router.refresh();
      } else {
        const b = res.body as { error?: string; message?: string } | null;
        toast.error(b?.error ?? b?.message ?? `Error ${res.status}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        onClick={() => {
          if (!open) {
            setSelected(currentTags.map((t) => t.toLowerCase()));
            setLoaded(false);
            setLoadError(null);
          }
          setOpen((o) => !o);
        }}
      >
        {open ? "Close" : "Edit tags"}
      </Button>

      {open ? (
        <div className="absolute right-0 z-40 mt-1 w-[min(20rem,calc(100vw-2rem))] max-h-[min(70dvh,28rem)] space-y-2 overflow-y-auto rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
          <div className="flex flex-wrap gap-1">
            {selected.length === 0 ? (
              <span className="text-xs text-muted-foreground">No tags selected</span>
            ) : (
              selected.map((t) => (
                <button key={t} type="button" onClick={() => toggle(t)} title="Remove">
                  <Badge variant="default" className="cursor-pointer">
                    {t} ×
                  </Badge>
                </button>
              ))
            )}
          </div>

          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tags…"
            className="h-8 text-xs"
          />

          <div className="max-h-36 overflow-y-auto rounded border border-border p-1">
            {!loaded ? (
              <p className="p-1 text-xs text-muted-foreground">Loading tags…</p>
            ) : loadError ? (
              <p className="p-1 text-xs text-destructive">{loadError}. Type tags below.</p>
            ) : filtered.length === 0 ? (
              <p className="p-1 text-xs text-muted-foreground">No tags match filter</p>
            ) : (
              filtered.map((o) => {
                const on = selected.includes(o.slug);
                return (
                  <button
                    key={o.slug}
                    type="button"
                    onClick={() => toggle(o.slug)}
                    className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-muted/50 ${
                      on ? "bg-primary/10 text-primary" : ""
                    }`}
                  >
                    <span className="truncate">{o.label}</span>
                    <span className="ml-2 shrink-0 font-mono text-[10px] text-muted-foreground">
                      {o.slug}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="flex flex-wrap gap-1">
            {["unknown", "alpha"].map((slug) => (
              <button key={slug} type="button" onClick={() => toggle(slug)}>
                <Badge
                  variant={selected.includes(slug) ? "default" : "muted"}
                  className="cursor-pointer"
                >
                  {slug}
                </Badge>
              </button>
            ))}
          </div>

          <div className="flex gap-1">
            <Input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
              placeholder="Type slug (e.g. defi)"
              className="h-8 flex-1 font-mono text-xs"
            />
            <Button type="button" size="sm" variant="secondary" className="h-8" onClick={addCustom}>
              Add
            </Button>
          </div>

          <div className="flex items-center justify-end gap-1 border-t border-border pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setFilter("");
                setCustom("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={save}
              disabled={busy || selected.length === 0}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
