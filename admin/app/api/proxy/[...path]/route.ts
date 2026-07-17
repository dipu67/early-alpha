import { getSession } from "@/lib/session";
import { backendFetch, backendFetchRaw } from "@/lib/api";
import { requiredRoleFor, atLeast } from "@/lib/rbac";

// BFF proxy: /api/proxy/<backend-path> -> backend /<backend-path>, with the
// admin key attached server-side. Session-gated AND role-gated: the required
// role for each (method, path) is enforced here, the real security boundary.
// The browser never holds the backend key.

/** Long-running backup export/import can exceed default serverless limits. */
export const maxDuration = 300;

function isBackupExport(method: string, target: string): boolean {
  return (
    method.toUpperCase() === "GET" &&
    (target === "/api/backup/export" || target.endsWith("/backup/export"))
  );
}

async function handle(
  request: Request,
  ctx: RouteContext<"/api/proxy/[...path]">,
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { path } = await ctx.params;
  // Do not encodeURIComponent path segments — Express matches literal /api/...
  // and encoding can produce %2F-style paths that 404 on some runtimes.
  const target = "/" + path.join("/");

  const needed = requiredRoleFor(request.method, target);
  if (!atLeast(session.role, needed)) {
    return Response.json({ error: "forbidden", requiredRole: needed }, { status: 403 });
  }

  const query: Record<string, string> = {};
  new URL(request.url).searchParams.forEach((v, k) => {
    query[k] = v;
  });

  // ── File download: stream raw body + Content-Disposition (no re-JSON) ──
  if (isBackupExport(request.method, target)) {
    try {
      const raw = await backendFetchRaw(target, {
        method: "GET",
        query,
      });

      if (!raw.ok) {
        let errorBody: unknown = { error: `export_failed_${raw.status}` };
        try {
          const text = new TextDecoder().decode(raw.body);
          errorBody = text ? JSON.parse(text) : errorBody;
        } catch {
          /* keep default */
        }
        return Response.json(errorBody, { status: raw.status });
      }

      if (raw.body.byteLength === 0) {
        return Response.json(
          { error: "export_empty", message: "Backend returned an empty backup" },
          { status: 502 },
        );
      }

      const headers = new Headers();
      headers.set(
        "Content-Type",
        raw.headers.get("content-type") ?? "application/json; charset=utf-8",
      );
      const cd = raw.headers.get("content-disposition");
      if (cd) {
        headers.set("Content-Disposition", cd);
      } else {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        headers.set(
          "Content-Disposition",
          `attachment; filename="early-alpha-backup-${stamp}.json"`,
        );
      }
      // Hint browsers not to sniff / cache sensitive dumps
      headers.set("Cache-Control", "no-store");
      headers.set("X-Content-Type-Options", "nosniff");

      return new Response(raw.body, { status: raw.status, headers });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json(
        { error: "export_proxy_failed", message: msg },
        { status: 502 },
      );
    }
  }

  let body: unknown;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const text = await request.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
  }

  try {
    const result = await backendFetch(target, {
      method: request.method,
      body,
      query,
    });
    return Response.json(result.body, { status: result.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: "proxy_upstream_failed", message: msg },
      { status: 502 },
    );
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
