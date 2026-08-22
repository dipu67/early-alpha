"use client";

import { useState, useCallback, Fragment } from "react";
import { Send, Loader2, Pencil, ExternalLink, Globe, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TopicPicker } from "@/components/topic-picker";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/cn";
import { categoryDisplay, projectStatus, isEnriched } from "@/lib/types";
import { timeAgo } from "@/lib/time";
import { ProjectDetailPanel } from "./project-detail-panel";

const STATUS_COLORS: Record<string, string> = {
  discovered: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  investigating: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  watching: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  launched: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  archived: "bg-muted text-muted-foreground",
};

export function ProjectTableWithCheckboxes({ items }: { items: Project[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [topic, setTopic] = useState("");
  const [editing, setEditing] = useState<Project | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const selectAll = useCallback(() => {
    if (selected.length === items.length) setSelected([]);
    else setSelected(items.map((i) => i.id));
  }, [items, selected]);

  async function sendAlert() {
    if (selected.length === 0) {
      toast.error("Select at least one project");
      return;
    }
    setSending(true);
    try {
      const res = await proxy("/api/projects/send-selected-alert", {
        method: "POST",
        body: { ids: selected, topicId: topic ? Number(topic) : null },
      });
      const b = res.body as { error?: string; sent?: boolean; count?: number } | null;
      if (res.ok && b?.sent) {
        toast.success(`Sent ${selected.length} project(s) to TG topic ${topic || "default"}`);
        setSelected([]);
      } else {
        toast.error(b?.error ?? `Failed (${res.status})`);
      }
    } finally {
      setSending(false);
    }
  }

  function bioPreview(p: Project): string | null {
    return p.description?.trim() || p.project?.description?.trim() || null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 shadow-sm">
        <Button size="sm" variant="outline" onClick={selectAll} className="h-7 text-xs">
          {selected.length === items.length ? "Deselect all" : "Select all"}
        </Button>
        <span className="text-xs text-muted-foreground">{selected.length} selected</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Topic:</span>
          <TopicPicker value={topic} onChange={(v) => setTopic(v)} compact className="min-w-[10rem]" />
        </div>
        <Button size="sm" disabled={sending || selected.length === 0} onClick={() => void sendAlert()} className="h-7 text-xs gap-1">
          {sending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
          Send to TG
        </Button>
      </div>
      <div className="rounded-lg border border-border bg-card">
        <table className="min-w-full text-sm">
          <thead className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 w-8 text-left"><Checkbox checked={items.length > 0 && selected.length === items.length} onCheckedChange={() => selectAll()} aria-label="Select all" /></th>
              <th className="px-3 py-2 text-left">Account</th>
              <th className="px-3 py-2 text-left">Category</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Chain</th>
              <th className="px-3 py-2 text-left">Detected</th>
              <th className="px-3 py-2 text-right">Followers</th>
              <th className="px-3 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => {
              const expandedId = expanded === p.id;
              const bio = bioPreview(p);
              const pProject = p.project;
              const website = pProject?.website || null;
              const github = pProject?.github || null;
              return (
                <Fragment key={p.id}>
                <tr key={p.id} className="border-b border-border/60 hover:bg-muted/20">
                  <td className="px-3 py-2"><Checkbox checked={selected.includes(p.id)} onCheckedChange={() => toggle(p.id)} aria-label={`Select @${p.username}`} /></td>
                  <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {p.profileImageUrl ? (
                      <img src={p.profileImageUrl} alt={p.username} className="size-7 rounded-full flex-shrink-0 object-cover" />
                    ) : (
                      <div className="size-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium flex-shrink-0">
                        {p.username.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div className="font-medium text-primary">
                        <a href={`https://x.com/${p.username}`} target="_blank" rel="noreferrer" className="hover:underline">@{p.username}</a>
                      </div>
                      {p.name ? <div className="text-xs text-muted-foreground truncate max-w-[12rem]">{p.name}</div> : null}
                    </div>
                  </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1 items-center">
                      {(p.tags.length > 0 ? p.tags : ["other"]).map((cat) => (
                        <span key={cat} className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                          {cat}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[projectStatus(p)] ?? "bg-muted text-muted-foreground"}`}>
                      {projectStatus(p)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {p.project?.chain ? (
                      <span className="inline-flex items-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300 px-2 py-0.5 text-xs font-medium">
                        {p.project.chain}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {p.firstSeenAt ? timeAgo(p.firstSeenAt) : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{p.followersCount ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => setExpanded(expandedId ? null : p.id)} className="rounded p-1 hover:bg-muted text-muted-foreground hover:text-primary" title={expandedId ? "Collapse" : "Expand"}>
                        <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={expandedId ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} /></svg>
                      </button>
                      <button type="button" onClick={() => setEditing(p)} className="rounded p-1 hover:bg-muted text-muted-foreground hover:text-primary" title="Edit">
                        <Pencil className="size-3" />
                      </button>
                    </div>
                  </td>
                </tr>
                {expandedId && (
                  <tr key={`${p.id}-exp`} className="border-b border-border/40 bg-muted/10">
                    <td colSpan={7} className="px-3 py-3">
                      <div className="grid grid-cols-2 gap-4 text-xs">
                        {bio ? (
                          <div className="col-span-2">
                            <span className="text-muted-foreground font-medium">Bio</span>
                            <p className="mt-0.5 text-muted-foreground whitespace-pre-wrap">{bio}</p>
                          </div>
                        ) : null}
                        {pProject?.name ? (
                          <div>
                            <span className="text-muted-foreground font-medium">Name</span>
                            <p className="mt-0.5">{pProject.name}</p>
                          </div>
                        ) : null}
                        {pProject?.projectStatus ? (
                          <div>
                            <span className="text-muted-foreground font-medium">Status</span>
                            <p className="mt-0.5">{pProject.projectStatus}</p>
                          </div>
                        ) : null}
                        {pProject?.chain ? (
                          <div>
                            <span className="text-muted-foreground font-medium">Chain</span>
                            <p className="mt-0.5">{pProject.chain}</p>
                          </div>
                        ) : null}
                        {website || github ? (
                          <div>
                            <span className="text-muted-foreground font-medium">Links</span>
                            <div className="mt-0.5 flex items-center gap-2">
                              {website ? (
                                <a href={website} target="_blank" rel="noreferrer" title={website} className="text-muted-foreground hover:text-primary">
                                  <Globe className="size-3.5" />
                                  <span className="text-xs truncate max-w-[12rem]">{website}</span>
                                </a>
                              ) : null}
                              {github ? (
                                <a href={github} target="_blank" rel="noreferrer" title={github} className="text-muted-foreground hover:text-primary">
                                  <Github className="size-3.5" />
                                  <span className="text-xs truncate max-w-[12rem]">{github}</span>
                                </a>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                        {p.firstSeenAt ? (
                          <div>
                            <span className="text-muted-foreground font-medium">First seen</span>
                            <p className="mt-0.5 text-xs">{timeAgo(p.firstSeenAt)}</p>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {editing && <ProjectDetailPanel project={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

