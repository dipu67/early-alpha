// Server-side backend client. Only runs on the Next.js server (Route Handlers /
// Server Components), so BACKEND_API_KEY never reaches the browser. The browser
// talks to /api/proxy, which calls these.

const BASE = process.env.BACKEND_URL ?? "http://localhost:4000";

function apiKey(): string {
  const key = process.env.BACKEND_API_KEY;
  if (!key) throw new Error("Missing BACKEND_API_KEY");
  return key;
}

export interface BackendResponse {
  status: number;
  ok: boolean;
  body: unknown;
}

/**
 * Call the early-alpha backend with the admin key attached. `path` starts with
 * "/api/..." (the backend's route space). Returns status + parsed body; never
 * throws on non-2xx so callers can forward the status through the proxy.
 */
export async function backendFetch(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {},
): Promise<BackendResponse> {
  const url = new URL(path, BASE);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const hasBody = init.body !== undefined && init.method && init.method !== "GET";
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      "x-api-key": apiKey(),
      ...(hasBody ? { "content-type": "application/json" } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
    cache: "no-store",
  });

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, ok: res.ok, body };
}
