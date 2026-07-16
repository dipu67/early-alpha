"use client";

import { useState } from "react";
import { ExternalLink, Loader2, RefreshCw, List } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/cn";
import type { AuthListsScanResult } from "@/lib/types";

export function AuthOwnedListsPanel() {
  const [data, setData] = useState<AuthListsScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [openAuth, setOpenAuth] = useState<string | null>(null);

  async function scan() {
    setBusy(true);
    const q = includeInactive ? "?activeOnly=false" : "?activeOnly=true";
    const res = await proxy(`/api/lists/owned${q}`);
    setBusy(false);
    if (res.ok) {
      const body = res.body as AuthListsScanResult;
      setData(body);
      toast.success(
        `Scanned ${body.authCount} auth · ${body.listCount} lists on X`,
      );
      if (body.items[0]) setOpenAuth(body.items[0].authAccountId);
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
    }
  }

  return (
    <Card className="mb-5">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 border-b border-border/60 py-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <List className="size-4 text-sky-500" />
            Auth-owned lists (live)
          </CardTitle>
          <CardDescription>
            Calls <code className="text-[11px]">getMyLists()</code> for every auth-pool account.
            Shows what each cookie owner has on X (not only ProjectLists in DB).
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            Include inactive
          </label>
          <Button type="button" size="sm" disabled={busy} onClick={() => void scan()}>
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {busy ? "Scanning…" : "Scan all auths"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {!data && !busy ? (
          <p className="text-sm text-muted-foreground">
            Click <strong>Scan all auths</strong> to fetch owned lists from Twitter for each
            account in the pool.
          </p>
        ) : null}

        {busy && !data ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Calling getMyLists for each auth account…
          </div>
        ) : null}

        {data ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">{data.authCount} auths</Badge>
              <Badge variant="muted">{data.listCount} lists</Badge>
              {data.duplicateListIds.length > 0 ? (
                <Badge variant="destructive">
                  {data.duplicateListIds.length} duplicate list ids
                </Badge>
              ) : null}
              <span className="text-muted-foreground">
                scanned {new Date(data.scannedAt).toLocaleString()}
              </span>
            </div>

            <ul className="space-y-2">
              {data.items.map((auth) => {
                const open = openAuth === auth.authAccountId;
                return (
                  <li
                    key={auth.authAccountId}
                    className="overflow-hidden rounded-lg border border-border"
                  >
                    <button
                      type="button"
                      className={cn(
                        "flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left text-sm",
                        "hover:bg-muted/40",
                        open && "bg-muted/30",
                      )}
                      onClick={() =>
                        setOpenAuth((id) =>
                          id === auth.authAccountId ? null : auth.authAccountId,
                        )
                      }
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">@{auth.username}</span>
                        {auth.ok ? (
                          <Badge variant="success" className="text-[10px]">
                            ok
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-[10px]">
                            error
                          </Badge>
                        )}
                        {!auth.isActive ? (
                          <Badge variant="muted" className="text-[10px]">
                            inactive
                          </Badge>
                        ) : null}
                        {auth.rateLimited ? (
                          <Badge variant="muted" className="text-[10px]">
                            rate limited
                          </Badge>
                        ) : null}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {auth.listCount} list{auth.listCount === 1 ? "" : "s"}
                      </span>
                    </button>

                    {open ? (
                      <div className="border-t border-border bg-card px-3 py-2">
                        {auth.error ? (
                          <p className="mb-2 text-xs text-destructive">{auth.error}</p>
                        ) : null}
                        {auth.lists.length === 0 ? (
                          <p className="py-2 text-xs text-muted-foreground">
                            No lists returned for this account.
                          </p>
                        ) : (
                          <ul className="divide-y divide-border">
                            {auth.lists.map((l) => (
                              <li
                                key={l.id}
                                className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm"
                              >
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-medium">{l.name}</span>
                                    {l.isPrivate ? (
                                      <Badge variant="muted" className="text-[10px]">
                                        private
                                      </Badge>
                                    ) : null}
                                    {l.projectSlug ? (
                                      <Badge variant="secondary" className="text-[10px]">
                                        DB · {l.projectSlug}
                                      </Badge>
                                    ) : (
                                      <Badge variant="muted" className="text-[10px]">
                                        not in ProjectLists
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                                    <span className="font-mono">{l.id}</span>
                                    {l.memberCount != null ? (
                                      <span>{l.memberCount} members</span>
                                    ) : null}
                                    {l.subscriberCount != null ? (
                                      <span>{l.subscriberCount} subs</span>
                                    ) : null}
                                  </div>
                                  {l.description ? (
                                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                                      {l.description}
                                    </p>
                                  ) : null}
                                </div>
                                <a
                                  href={`https://x.com/i/lists/${l.id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex shrink-0 items-center gap-0.5 text-xs text-primary hover:underline"
                                >
                                  Open <ExternalLink className="size-3" />
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
