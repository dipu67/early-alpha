"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, MapPin, Globe, Github, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import type { Project, ProjectTag } from "@/lib/types";
import { projectStatus } from "@/lib/types";

const STATUSES = [
  { value: "discovered", label: "Discovered", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  { value: "investigating", label: "Investigating", color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  { value: "watching", label: "Watching", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" },
  { value: "launched", label: "Launched", color: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
  { value: "archived", label: "Archived", color: "bg-muted text-muted-foreground" },
];

export function ProjectDetailPanel({ project, onClose }: { project: Project; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [tags, setTags] = useState<string[]>(project.tags.length > 0 ? project.tags : []);
  const [status, setStatus] = useState(projectStatus(project));
  const [chain, setChain] = useState(project.project?.chain ?? "");
  const [website, setWebsite] = useState(project.project?.website ?? "");
  const [github, setGithub] = useState(project.project?.github ?? "");

  // Tags state
  const [selectedTags, setSelectedTags] = useState<string[]>(project.tags || []);
  const [tagOptions, setTagOptions] = useState<{ slug: string; label: string }[]>([]);
  const [tagFilter, setTagFilter] = useState("");
  const [tagCustom, setTagCustom] = useState("");
  const [tagOpen, setTagOpen] = useState(false);
  const [tagLoading, setTagLoading] = useState(false);
  const tagRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tagOpen || tagOptions.length > 0) return;
    setTagLoading(true);
    proxy("/api/tags").then((res) => {
      setTagLoading(false);
      if (res.ok) {
        const body = res.body as { items: ProjectTag[] };
        const items = Array.isArray(body.items) ? body.items : [];
        setTagOptions(
          items
            .filter((t) => t.enabled !== false)
            .map((t) => ({ slug: t.slug, label: t.label || t.slug }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        );
      }
    });
  }, [tagOpen, tagOptions.length]);

  // Close tag popover on outside click
  useEffect(() => {
    if (!tagOpen) return;
    function onDoc(e: MouseEvent) {
      if (tagRef.current && !tagRef.current.contains(e.target as Node)) {
        setTagOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [tagOpen]);

  async function save() {
    setBusy(true);
    try {
      const res = await proxy(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        body: { projectStatus: status, chain: chain || null, website: website || null, github: github || null },
      });
      if (res.ok) {
        toast.success(`Saved @${project.username}`);
        router.refresh();
        onClose();
      } else {
        toast.error(`Failed (${res.status})`);
      }
    } finally {
      setBusy(false);
    }
  }

  function toggleTag(slug: string) {
    const s = slug.trim().toLowerCase();
    if (!s) return;
    setSelectedTags((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  }

  function addCustomTag() {
    const parts = tagCustom.split(/[,\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (parts.length === 0) return;
    setSelectedTags((prev) => [...new Set([...prev, ...parts])]);
    setTagCustom("");
  }

  async function reclassify() {
    if (selectedTags.length === 0) {
      toast.error("Select at least one tag");
      return;
    }
    setBusy(true);
    try {
      const res = await proxy("/api/reclassify", {
        method: "POST",
        body: { accountId: project.id, tags: selectedTags },
      });
      if (res.ok) {
        toast.success(`Tags updated: ${selectedTags.join(", ")}`);
        router.refresh();
        onClose();
      } else {
        const b = res.body as { error?: string } | null;
        toast.error(b?.error ?? `Error ${res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const filteredTags = tagFilter.trim()
    ? tagOptions.filter((o) => o.slug.includes(tagFilter.toLowerCase()) || o.label.toLowerCase().includes(tagFilter.toLowerCase()))
    : tagOptions;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-4 shadow-lg space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Edit @{project.username}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>&times;</Button>
        </div>

        <div className="space-y-3">
          {/* Tags */}
          <div>
            <Label className="text-xs text-muted-foreground">Tags</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(project.tags.length > 0 ? project.tags : ["other"]).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Status */}
          <div>
            <Label className="text-xs text-muted-foreground">Status</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {STATUSES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStatus(s.value)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    status === s.value
                      ? "border-transparent ring-2 ring-primary"
                      : "border-border bg-background"
                  } ${s.color}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Chain & Website */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="chain" className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="size-3" /> Chain
              </Label>
              <Input id="chain" value={chain} onChange={(e) => setChain(e.target.value)} placeholder="e.g. ETH, SOL" className="mt-1 h-8" />
            </div>
            <div>
              <Label htmlFor="website" className="text-xs text-muted-foreground flex items-center gap-1">
                <Globe className="size-3" /> Website
              </Label>
              <Input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://..." className="mt-1 h-8" />
            </div>
          </div>

          {/* GitHub */}
          <div>
            <Label htmlFor="github" className="text-xs text-muted-foreground flex items-center gap-1">
              <Github className="size-3" /> GitHub
            </Label>
            <Input id="github" value={github} onChange={(e) => setGithub(e.target.value)} placeholder="https://github.com/..." className="mt-1 h-8" />
          </div>

          {/* Tags / Reclassify */}
          <div ref={tagRef} className="space-y-2">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Tags className="size-3" /> Tags ({selectedTags.length})
            </Label>

            {/* Selected tags */}
            <div className="flex flex-wrap gap-1">
              {selectedTags.length === 0 ? (
                <span className="text-xs text-muted-foreground">No tags selected</span>
              ) : (
                selectedTags.map((t) => (
                  <button key={t} type="button" onClick={() => toggleTag(t)} title="Remove">
                    <Badge variant="default" className="cursor-pointer">
                      {t} ×
                    </Badge>
                  </button>
                ))
              )}
            </div>

            {/* Tag picker button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full text-xs"
              onClick={() => setTagOpen(!tagOpen)}
            >
              {tagOpen ? "Close" : "Select tags"}
            </Button>

            {/* Tag picker dropdown */}
            {tagOpen && (
              <div className="rounded-lg border border-border bg-popover p-2 space-y-2">
                <Input
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  placeholder="Filter tags…"
                  className="h-7 text-xs"
                />

                <div className="max-h-32 overflow-y-auto space-y-0.5">
                  {tagLoading ? (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  ) : filteredTags.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No tags match</p>
                  ) : (
                    filteredTags.map((o) => {
                      const on = selectedTags.includes(o.slug);
                      return (
                        <button
                          key={o.slug}
                          type="button"
                          onClick={() => toggleTag(o.slug)}
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

                {/* Custom tag input */}
                <div className="flex gap-1">
                  <Input
                    value={tagCustom}
                    onChange={(e) => setTagCustom(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomTag(); } }}
                    placeholder="Add custom tag…"
                    className="h-7 flex-1 text-xs"
                  />
                  <Button type="button" size="sm" variant="secondary" className="h-7" onClick={addCustomTag}>
                    Add
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            Save
          </Button>
        </div>

        {/* Reclassify button */}
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="text-xs text-muted-foreground hover:text-primary"
            onClick={() => void reclassify()}
            disabled={busy || selectedTags.length === 0}
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : "Reclassify"}
          </Button>
        </div>
      </div>
    </div>
  );
}
