"use client";

// Client-side helper to call the BFF proxy. The browser never sees the backend
// key; this hits /api/proxy/<backend-path> which attaches it server-side.

export async function proxy(
  backendPath: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; ok: boolean; body: unknown }> {
  const hasBody = init.body !== undefined && init.method && init.method !== "GET";
  const res = await fetch(`/api/proxy${backendPath}`, {
    method: init.method ?? "GET",
    headers: hasBody ? { "content-type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, ok: res.ok, body };
}
