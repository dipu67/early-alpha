import { cookies } from "next/headers";
import { createSessionValue, sessionCookie } from "@/lib/session";
import { isRole } from "@/lib/rbac";
import { backendFetch } from "@/lib/api";

/** POST /api/login { email, password } -> verify via backend, set session cookie. */
export async function POST(request: Request): Promise<Response> {
  let email = "";
  let password = "";
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    email = body.email ?? "";
    password = body.password ?? "";
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const result = await backendFetch("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });

  if (!result.ok) {
    return Response.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const user = result.body as { id?: string; email?: string; role?: string };
  if (!user.id || !user.email || !user.role || !isRole(user.role)) {
    return Response.json({ error: "bad_user" }, { status: 500 });
  }

  const store = await cookies();
  store.set(
    sessionCookie.name,
    await createSessionValue({ uid: user.id, email: user.email, role: user.role }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: sessionCookie.maxAge,
    },
  );

  return Response.json({ ok: true, role: user.role });
}
