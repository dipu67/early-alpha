"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";

/** Add a watched account by username only — backend resolves via getUserByScreenName. */
export function AddWatchForm() {
  const router = useRouter();
  const canWrite = useCan("editor");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  if (!canWrite) return null;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const raw = username.trim().replace(/^@/, "");
    if (!raw) {
      toast.error("Username required");
      return;
    }
    if (!/^[A-Za-z0-9_]{1,15}$/.test(raw)) {
      toast.error("Invalid Twitter username");
      return;
    }

    setBusy(true);
    try {
      const res = await proxy("/api/watchlist", {
        method: "POST",
        body: { username: raw },
      });
      if (res.ok) {
        const body = res.body as {
          username?: string;
          name?: string | null;
          followersCount?: number | null;
        } | null;
        const handle = body?.username ?? raw;
        const bits = [`Watching @${handle}`];
        if (body?.name) bits.push(body.name);
        if (body?.followersCount != null) {
          bits.push(`${body.followersCount.toLocaleString()} followers`);
        }
        toast.success(bits.join(" · "));
        setUsername("");
        router.refresh();
      } else {
        const b = res.body as { error?: string } | null;
        const err = b?.error ?? `Error ${res.status}`;
        if (err === "already_watching") {
          toast.error(`@${raw} is already being watched`);
        } else if (err === "invalid_username") {
          toast.error("Invalid Twitter username");
        } else if (err.startsWith("user_not_found")) {
          toast.error(`Could not find @${raw}`);
        } else {
          toast.error(err);
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={add} className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <Input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="@username"
        className="w-full sm:w-52"
        autoComplete="off"
        disabled={busy}
      />
      <Button type="submit" disabled={busy || !username.trim()} className="w-full sm:w-auto">
        {busy ? "Looking up…" : "Add watch"}
      </Button>
      <span className="text-xs text-muted-foreground sm:basis-full lg:basis-auto">
        Resolves user id via Twitter (UserByScreenName)
      </span>
    </form>
  );
}
