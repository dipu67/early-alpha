import { getSession } from "@/lib/session";
import { backendFetch } from "@/lib/api";
import { requiredRoleFor, atLeast } from "@/lib/rbac";

// BFF proxy: /api/proxy/<backend-path> -> backend /<backend-path>, with the
// admin key attached server-side. Session-gated AND role-gated: the required
// role for each (method, path) is enforced here, the real security boundary.
// The browser never holds the backend key.

async function handle(
  request: Request,
  ctx: RouteContext<"/api/proxy/[...path]">,
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { path } = await ctx.params;
  const target = "/" + path.map(encodeURIComponent).join("/");

  const needed = requiredRoleFor(request.method, target);
  if (!atLeast(session.role, needed)) {
    return Response.json({ error: "forbidden", requiredRole: needed }, { status: 403 });
  }

  const query: Record<string, string> = {};
  new URL(request.url).searchParams.forEach((v, k) => {
    query[k] = v;
  });

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

  const result = await backendFetch(target, { method: request.method, body, query });
  return Response.json(result.body, { status: result.status });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
