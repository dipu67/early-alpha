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

export interface BackendRawResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  /** Raw response bytes (do not re-parse as JSON for large downloads). */
  body: ArrayBuffer;
}

function buildUrl(
  path: string,
  query?: Record<string, string | string[] | undefined>,
): URL {
  const url = new URL(path, BASE);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== "") {
        if (Array.isArray(v)) {
          for (const item of v) url.searchParams.append(k, item);
        } else {
          url.searchParams.set(k, v);
        }
      }
    }
  }
  return url;
}

/**
 * Call the early-alpha backend with the admin key attached. `path` starts with
 * "/api/..." (the backend's route space). Returns status + parsed body; never
 * throws on non-2xx so callers can forward the status through the proxy.
 */
export async function backendFetch(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | string[] | undefined> } = {},
): Promise<BackendResponse> {
  try {
    const url = buildUrl(path, init.query);

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
  } catch (err) {
    return { status: 0, ok: false, body: { error: "backend_unavailable", message: err instanceof Error ? err.message : String(err) } };
  }
}

/**
 * Same as backendFetch but keeps the body as raw bytes and preserves response
 * headers. Use for file downloads (backup export) so we do not JSON.parse +
 * Response.json a multi‑MB payload (slow, can OOM / empty downloads).
 */
export async function backendFetchRaw(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {},
): Promise<BackendRawResponse> {
  try {
    const url = buildUrl(path, init.query);

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

    const body = await res.arrayBuffer();
    return {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      body,
    };
  } catch (err) {
    return { status: 0, ok: false, headers: new Headers(), body: new ArrayBuffer(0) };
  }
}
