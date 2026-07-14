"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";

/** Add / update a Twitter auth account (credential pool). Editor+ only. */
export function AddAuthForm() {
  const router = useRouter();
  const canWrite = useCan("editor");
  const [f, setF] = useState({ id: "", username: "", authToken: "", ct0: "" });
  const [busy, setBusy] = useState(false);

  if (!canWrite) return null;

  function set(k: keyof typeof f) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!f.id || !f.username || !f.authToken || !f.ct0) {
      toast.error("All fields required");
      return;
    }
    setBusy(true);
    const res = await proxy("/api/auth-accounts", { method: "POST", body: f });
    setBusy(false);
    if (res.ok) {
      setF({ id: "", username: "", authToken: "", ct0: "" });
      toast.success("Saved");
      router.refresh();
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
    }
  }

  return (
    <form onSubmit={add} className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-5">
      <Input value={f.id} onChange={set("id")} placeholder="id (twitter user id)" />
      <Input value={f.username} onChange={set("username")} placeholder="username" />
      <Input value={f.authToken} onChange={set("authToken")} placeholder="auth_token" />
      <Input value={f.ct0} onChange={set("ct0")} placeholder="ct0" />
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Add / update"}
      </Button>
    </form>
  );
}
