"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Beaker,
  Eye,
  Loader2,
  Play,
  Save,
  Trash2,
  CheckSquare,
  Square,
  Database,
  Sparkles,
  Send,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import { fmtDate, fmtNum, type GrokResearchPrompt, type GrokResearchRunSummary } from "@/lib/types";
import { cn } from "@/lib/cn";
import { TopicPicker } from "@/components/topic-picker";

type ProjectRow = {
  id: string;
  username: string;
  name: string;
  description: string | null;
  tags: string[];
  followersCount: number | null;
};

export function ResearchPanel() {
  const canWrite = useCan("editor");

  const [prompts, setPrompts] = useState<GrokResearchPrompt[]>([]);
  const [promptId, setPromptId] = useState<string>("");
  const [template, setTemplate] = useState("");
  const [tag, setTag] = useState("nft");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [projectSearch, setProjectSearch] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [runs, setRuns] = useState<GrokResearchRunSummary[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<{
    response: string | null;
    renderedPrompt: string;
    status: string;
    error: string | null;
    title: string | null;
  } | null>(null);

  const [saveName, setSaveName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [pendingDeleteRun, setPendingDeleteRun] = useState<string | null>(null);
  const [tgTopicId, setTgTopicId] = useState("");
  const [tgSending, setTgSending] = useState(false);
  const didHydratePrompts = useRef(false);

  const activePrompt = useMemo(
    () => prompts.find((p) => String(p.id) === String(promptId)) ?? null,
    [prompts, promptId],
  );

  function slugifyName(raw: string): string {
    return raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
  }

  function applyPromptToEditor(row: GrokResearchPrompt) {
    setPromptId(String(row.id));
    setTemplate(row.template);
    setSaveName(row.isBuiltin ? `${row.name} (copy)` : row.name);
    if (row.defaultTag) setTag(row.defaultTag);
  }

  const loadPrompts = useCallback(async (opts?: { selectId?: string; hydrate?: boolean }) => {
    const res = await proxy("/api/grok/prompts");
    if (!res.ok) {
      toast.error("Failed to load prompts from DB — run: npm run grok:store-prompts");
      return [] as GrokResearchPrompt[];
    }
    const body = res.body as { items: GrokResearchPrompt[] };
    const items = Array.isArray(body.items) ? body.items : [];
    setPrompts(items);

    if (items.length === 0) {
      toast.error("No prompts in DB. Run: npm run grok:store-prompts");
      return items;
    }

    const prefer = items.find((p) => p.slug === "nft-deep-dive") ?? items[0]!;

    if (opts?.selectId) {
      const row = items.find((p) => String(p.id) === String(opts.selectId)) ?? prefer;
      if (opts.hydrate !== false) applyPromptToEditor(row);
      else setPromptId(String(row.id));
      return items;
    }

    if (!didHydratePrompts.current || opts?.hydrate) {
      didHydratePrompts.current = true;
      applyPromptToEditor(prefer);
    } else {
      // Keep current selection if still in list
      setPromptId((prev) =>
        prev && items.some((p) => String(p.id) === String(prev))
          ? String(prev)
          : String(prefer.id),
      );
    }
    return items;
  }, []);

  const loadRuns = useCallback(async () => {
    const res = await proxy("/api/grok/research/runs?limit=30");
    if (res.ok) {
      const body = res.body as { items: GrokResearchRunSummary[] };
      setRuns(body.items);
    }
  }, []);

  useEffect(() => {
    void loadPrompts();
    void loadRuns();
  }, [loadPrompts, loadRuns]);

  function selectPrompt(id: string) {
    const p = prompts.find((x) => String(x.id) === String(id));
    setPromptId(String(id));
    if (p) {
      setTemplate(p.template);
      setSaveName(p.isBuiltin ? `${p.name} (copy)` : p.name);
      if (p.defaultTag) setTag(p.defaultTag);
    }
    setPreview(null);
  }

  async function loadProjects() {
    if (!tag.trim()) {
      toast.error("Enter a tag (e.g. nft)");
      return;
    }
    setLoadingProjects(true);
    try {
      const params = new URLSearchParams({
        tag: tag.trim().toLowerCase(),
        limit: "50",
      });
      if (projectSearch.trim()) params.set("search", projectSearch.trim());
      const res = await proxy(`/api/grok/research/projects?${params}`);
      if (res.ok) {
        const body = res.body as { items: ProjectRow[]; total: number };
        setProjects(body.items);
        // Auto-select top 10 by followers for convenience
        setSelected(new Set(body.items.slice(0, 10).map((p) => p.id)));
        toast.success(`Loaded ${body.total} projects for #${tag.trim()}`);
      } else {
        toast.error("Failed to load projects");
      }
    } finally {
      setLoadingProjects(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(projects.map((p) => p.id)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  const selectedIds = useMemo(() => [...selected], [selected]);

  async function doPreview() {
    if (selectedIds.length === 0) {
      toast.error("Select at least one project");
      return;
    }
    if (!template.trim()) {
      toast.error("Prompt template is empty");
      return;
    }
    setBusy(true);
    try {
      const res = await proxy("/api/grok/research/preview", {
        method: "POST",
        body: {
          template,
          tag: tag.trim().toLowerCase(),
          projectIds: selectedIds,
        },
      });
      if (res.ok) {
        const body = res.body as { rendered: string; projectCount: number };
        setPreview(body.rendered);
        toast.success(`Preview ready (${body.projectCount} projects)`);
      } else {
        const b = res.body as { error?: string } | null;
        toast.error(b?.error ?? `Error ${res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function savePromptOnly() {
    if (!canWrite) return;
    if (!saveName.trim()) {
      toast.error("Name required to save prompt");
      return;
    }
    if (template.trim().length < 20) {
      toast.error("Template too short (min 20 chars)");
      return;
    }

    // Never write over builtins — derive a custom slug from the save name.
    // If user is editing an existing custom prompt, keep its slug.
    let slug = "";
    if (activePrompt && !activePrompt.isBuiltin) {
      slug = activePrompt.slug;
    } else {
      slug = slugifyName(saveName);
      if (!slug) {
        toast.error("Invalid name for slug");
        return;
      }
      // Avoid colliding with builtin slugs
      if (prompts.some((p) => p.isBuiltin && p.slug === slug)) {
        slug = `my-${slug}`.slice(0, 64);
      }
    }

    setBusy(true);
    try {
      const res = await proxy("/api/grok/prompts/upsert", {
        method: "POST",
        body: {
          name: saveName.trim(),
          slug,
          template,
          defaultTag: tag.trim().toLowerCase() || null,
          description:
            activePrompt && !activePrompt.isBuiltin
              ? activePrompt.description
              : `Custom research prompt · tag ${tag || "any"}`,
        },
      });
      if (res.ok) {
        const row = res.body as GrokResearchPrompt;
        toast.success(
          res.status === 201
            ? `Saved to DB: ${row.slug}`
            : `Updated in DB: ${row.slug}`,
        );
        setTemplate(row.template);
        setSaveName(row.name);
        setPromptId(String(row.id));
        await loadPrompts({ selectId: String(row.id), hydrate: true });
      } else {
        const b = res.body as { error?: string } | null;
        const err = b?.error ?? `Error ${res.status}`;
        if (err.includes("builtin_slug")) {
          toast.error("That name matches a builtin — rename (e.g. add “my ”)");
        } else if (err === "forbidden") {
          toast.error("Need editor role to save prompts");
        } else {
          toast.error(err);
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function runResearch() {
    if (!canWrite) return;
    if (selectedIds.length === 0) {
      toast.error("Select at least one project");
      return;
    }
    setBusy(true);
    setRunDetail(null);
    try {
      const body: Record<string, unknown> = {
        promptId: promptId || null,
        template,
        tag: tag.trim().toLowerCase(),
        projectIds: selectedIds,
        title: `${tag || "research"} · ${selectedIds.length} projects`,
      };
      // Optionally save if name set and template diverged from builtin
      if (saveName.trim() && (!activePrompt || activePrompt.isBuiltin || activePrompt.template !== template)) {
        body.savePrompt = {
          name: saveName.trim(),
          defaultTag: tag.trim().toLowerCase() || null,
          description: `Saved from research UI`,
        };
      }

      const res = await proxy("/api/grok/research/run", {
        method: "POST",
        body,
      });
      const payload = res.body as {
        runId?: string;
        status?: string;
        response?: string | null;
        error?: string | null;
        renderedPrompt?: string;
      };

      if (payload.runId) {
        setActiveRunId(payload.runId);
        setRunDetail({
          response: payload.response ?? null,
          renderedPrompt: payload.renderedPrompt ?? "",
          status: payload.status ?? "error",
          error: payload.error ?? null,
          title: body.title as string,
        });
        if (payload.status === "success") {
          toast.success("Research complete");
        } else {
          toast.error(payload.error ?? "Grok failed");
        }
        await loadRuns();
        await loadPrompts();
      } else {
        toast.error(
          (payload as { error?: string }).error ?? `Error ${res.status}`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function openRun(id: string) {
    setActiveRunId(id);
    const res = await proxy(`/api/grok/research/runs/${id}`);
    if (res.ok) {
      const body = res.body as {
        response: string | null;
        renderedPrompt: string;
        status: string;
        error: string | null;
        title: string | null;
      };
      setRunDetail({
        response: body.response,
        renderedPrompt: body.renderedPrompt,
        status: body.status,
        error: body.error,
        title: body.title,
      });
    }
  }

  async function sendRunToTelegram() {
    if (!canWrite || !activeRunId) return;
    if (runDetail?.status !== "success" || !runDetail.response) {
      toast.error("Only successful research runs can be sent");
      return;
    }
    setTgSending(true);
    try {
      const topic =
        tgTopicId.trim() === "" ? null : Number(tgTopicId.trim());
      if (tgTopicId.trim() && !Number.isFinite(topic)) {
        toast.error("Topic id must be a number");
        return;
      }
      const res = await proxy(
        `/api/grok/research/runs/${activeRunId}/send-telegram`,
        {
          method: "POST",
          body: {
            topicId: topic,
            includePrompt: false,
          },
        },
      );
      if (res.ok) {
        const body = res.body as {
          parts?: number;
          topicId?: number | null;
          chatId?: string;
        };
        toast.success(
          `Sent to Telegram` +
            (body.topicId != null ? ` · topic ${body.topicId}` : "") +
            (body.parts && body.parts > 1 ? ` · ${body.parts} parts` : ""),
        );
      } else {
        const b = res.body as { error?: string } | null;
        toast.error(b?.error ?? `Error ${res.status}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setTgSending(false);
    }
  }

  async function deleteRun() {
    if (!pendingDeleteRun || !canWrite) return;
    setBusy(true);
    try {
      const res = await proxy(`/api/grok/research/runs/${pendingDeleteRun}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Run deleted");
        if (activeRunId === pendingDeleteRun) {
          setActiveRunId(null);
          setRunDetail(null);
        }
        setPendingDeleteRun(null);
        await loadRuns();
      } else toast.error("Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function seedSpecialPrompts() {
    if (!canWrite) return;
    setBusy(true);
    try {
      const res = await proxy("/api/grok/prompts/seed", {
        method: "POST",
        body: {},
      });
      if (res.ok) {
        const body = res.body as { upserted?: number; slugs?: string[] };
        toast.success(
          `Seeded ${body.upserted ?? 0} special prompts into DB (same as npm run grok:store-prompts)`,
        );
        await loadPrompts({ hydrate: true });
      } else {
        const b = res.body as { error?: string } | null;
        toast.error(
          b?.error === "forbidden"
            ? "Need editor role"
            : (b?.error ?? `Error ${res.status} — is the API restarted?`),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-primary" />
              Tools
            </CardTitle>
            <CardDescription>
              First-time setup: store built-in special prompts in Postgres. Same as{" "}
              <code className="text-xs">npm run grok:store-prompts</code>. Safe to
              re-run. Then use <strong>Save prompt to DB</strong> for your own
              templates.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void seedSpecialPrompts()}
              className="w-full sm:w-auto"
            >
              <Database className="size-3.5" />
              Seed special prompts
            </Button>
            <span className="text-xs text-muted-foreground sm:self-center">
              {prompts.length === 0
                ? "DB empty — seed or run CLI"
                : `${prompts.filter((p) => p.isBuiltin).length} builtin · ${prompts.filter((p) => !p.isBuiltin).length} custom`}
            </span>
          </CardContent>
        </Card>
      ) : null}

      {/* Step 1: tag + projects */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Beaker className="size-4 text-primary" />
            1 · Select projects by tag
          </CardTitle>
          <CardDescription>
            Example: tag <code className="text-xs">nft</code> → pick accounts →
            build a special Grok prompt and run research.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="tag e.g. nft"
              className="w-full font-mono sm:w-40"
            />
            <Input
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
              placeholder="filter username (optional)"
              className="w-full sm:w-48"
            />
            <Button
              type="button"
              size="sm"
              disabled={loadingProjects}
              onClick={() => void loadProjects()}
            >
              {loadingProjects ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Load projects
            </Button>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {["nft", "defi", "gamefi", "ai", "meme", "unknown"].map((t) => (
                <button
                  key={t}
                  type="button"
                  className="rounded-full border border-border px-2 py-0.5 hover:bg-muted"
                  onClick={() => setTag(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {projects.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {selected.size} / {projects.length} selected
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={selectAll}>
                  Select all
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={selectNone}>
                  Clear
                </Button>
              </div>
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {projects.map((p) => {
                  const on = selected.has(p.id);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => toggle(p.id)}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50",
                          on && "bg-primary/10",
                        )}
                      >
                        {on ? (
                          <CheckSquare className="mt-0.5 size-4 shrink-0 text-primary" />
                        ) : (
                          <Square className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">@{p.username}</span>
                            <span className="text-xs text-muted-foreground">
                              {fmtNum(p.followersCount)} flw
                            </span>
                            {p.tags.slice(0, 3).map((t) => (
                              <Badge key={t} variant="muted" className="text-[10px]">
                                {t}
                              </Badge>
                            ))}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {p.name}
                            {p.description ? ` · ${p.description}` : ""}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Load a tag to list projects. Top 10 are auto-selected.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Step 2: special prompt */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">2 · Special prompt</CardTitle>
          <CardDescription>
            Placeholders:{" "}
            <code className="text-xs">{"{{tag}}"}</code>{" "}
            <code className="text-xs">{"{{count}}"}</code>{" "}
            <code className="text-xs">{"{{handles}}"}</code>{" "}
            <code className="text-xs">{"{{projects}}"}</code> — filled from your
            selection. Built-ins ship with the API; save your own to the DB.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={promptId}
              onChange={(e) => selectPrompt(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-ring sm:max-w-md"
            >
              {prompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.isBuiltin ? " (builtin)" : ""}
                  {p.defaultTag ? ` · ${p.defaultTag}` : ""}
                </option>
              ))}
            </select>
            {activePrompt?.description ? (
              <span className="text-xs text-muted-foreground">
                {activePrompt.description}
              </span>
            ) : null}
          </div>

          <textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            rows={12}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:ring-2 focus:ring-ring"
            spellCheck={false}
          />

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Prompt name to save"
              className="w-full sm:w-56"
              disabled={!canWrite}
            />
            {canWrite ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void savePromptOnly()}
                >
                  <Save className="size-3.5" />
                  Save prompt to DB
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void doPreview()}
                >
                  <Eye className="size-3.5" />
                  Preview filled prompt
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || selectedIds.length === 0}
                  onClick={() => void runResearch()}
                >
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  Run research with Grok
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Editor+ to run/save.</p>
            )}
          </div>

          {preview ? (
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Preview
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
                {preview}
              </pre>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Step 3: result + history */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Past runs</CardTitle>
            <CardDescription>Stored research results</CardDescription>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <EmptyState title="No runs yet" description="Run research above." />
            ) : (
              <ul className="max-h-80 space-y-1 overflow-y-auto">
                {runs.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => void openRun(r.id)}
                      className={cn(
                        "w-full rounded-md border px-2.5 py-2 text-left text-sm transition-colors",
                        activeRunId === r.id
                          ? "border-primary/40 bg-primary/10"
                          : "border-border hover:bg-muted/40",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant={
                            r.status === "success"
                              ? "success"
                              : r.status === "error"
                                ? "destructive"
                                : "muted"
                          }
                          className="text-[10px]"
                        >
                          {r.status}
                        </Badge>
                        {r.tag ? (
                          <Badge variant="secondary" className="text-[10px]">
                            {r.tag}
                          </Badge>
                        ) : null}
                        <span className="text-xs text-muted-foreground">
                          {r.projectCount} projects
                        </span>
                      </div>
                      <div className="mt-0.5 truncate font-medium">
                        {r.title ?? `Run #${r.id}`}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {fmtDate(r.createdAt)}
                        {r.promptName ? ` · ${r.promptName}` : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">
                  {runDetail?.title ?? "Research result"}
                </CardTitle>
                <CardDescription>
                  Grok answer stored in the database · send via grammy
                  sendRichMessage to a forum topic
                </CardDescription>
              </div>
              {activeRunId && canWrite ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setPendingDeleteRun(activeRunId)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {runDetail?.status === "success" && canWrite ? (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="min-w-[12rem] flex-1 space-y-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Topic (Group Manager)
                  </div>
                  <TopicPicker
                    value={tgTopicId}
                    emptyLabel="Default topic"
                    onChange={(v) => setTgTopicId(v)}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={tgSending || busy}
                  onClick={() => void sendRunToTelegram()}
                >
                  {tgSending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                  Send to Telegram
                </Button>
                <span className="text-[11px] text-muted-foreground sm:basis-full">
                  Pick a topic from Group Manager catalog. Empty = default. RichMessage (markdown).
                </span>
              </div>
            ) : null}

            {!runDetail ? (
              <EmptyState
                title="No result open"
                description="Run research or open a past run."
              />
            ) : runDetail.status === "error" ? (
              <p className="text-sm text-destructive">
                {runDetail.error ?? "Unknown error"}
              </p>
            ) : (
              <div className="max-h-[min(36rem,70dvh)] space-y-4 overflow-y-auto">
                <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap break-words text-sm">
                  {runDetail.response}
                </div>
                <details className="rounded-md border border-border p-2 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    Rendered prompt sent to Grok
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono">
                    {runDetail.renderedPrompt}
                  </pre>
                </details>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={pendingDeleteRun !== null}
        onOpenChange={(o) => {
          if (!busy && !o) setPendingDeleteRun(null);
        }}
        title="Delete research run?"
        description="Removes this run and its Grok response from the database."
        confirmLabel="Delete"
        destructive
        loading={busy}
        onConfirm={deleteRun}
      />
    </div>
  );
}
