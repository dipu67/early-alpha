"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";

/**
 * Add / update a Twitter auth account.
 * Only auth_token + ct0 — backend validates via TwitterClient.getCurrentUser
 * and stores twitter user id + username.
 */
export function AddAuthForm() {
  const router = useRouter();
  const canWrite = useCan("editor");
  const [authToken, setAuthToken] = useState("");
  const [ct0, setCt0] = useState("");
  const [busy, setBusy] = useState(false);

  if (!canWrite) return null;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!authToken.trim() || !ct0.trim()) {
      toast.error("auth_token and ct0 required");
      return;
    }
    setBusy(true);
    try {
      const res = await proxy("/api/auth-accounts", {
        method: "POST",
        body: {
          authToken: authToken.trim(),
          ct0: ct0.trim(),
        },
      });
      if (res.ok) {
        const b = res.body as { username?: string; id?: string };
        setAuthToken("");
        setCt0("");
        toast.success(
          b.username
            ? `Valid · saved @${b.username}`
            : "Valid · saved auth account",
        );
        router.refresh();
      } else {
        const b = res.body as { error?: string } | null;
        const err = b?.error ?? `Error ${res.status}`;
        toast.error(
          err.includes("invalid_cookies")
            ? `Invalid cookies — ${err.replace(/^invalid_cookies:\s*/i, "")}`
            : err,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void add(e)}
      className="mb-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="min-w-0 flex-1 space-y-1 sm:min-w-[12rem]">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          auth_token
        </span>
        <Input
          value={authToken}
          onChange={(e) => setAuthToken(e.target.value)}
          placeholder="Paste auth_token cookie"
          className="font-mono text-xs"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="min-w-0 flex-1 space-y-1 sm:min-w-[12rem]">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          ct0
        </span>
        <Input
          value={ct0}
          onChange={(e) => setCt0(e.target.value)}
          placeholder="Paste ct0 cookie"
          className="font-mono text-xs"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <Button type="submit" disabled={busy} className="h-9 shrink-0">
        {busy ? "Checking…" : "Validate & add"}
      </Button>
      <p className="w-full text-[11px] text-muted-foreground">
        Only two cookies. We call Twitter <code className="text-[10px]">getCurrentUser</code>{" "}
        with them; if valid, the account is saved with its real @username and user id.
      </p>
    </form>
  );
}
