import { cookies } from "next/headers";
import { sessionCookie } from "@/lib/session";

/** POST /api/logout -> clear the session cookie. */
export async function POST(): Promise<Response> {
  const store = await cookies();
  store.set(sessionCookie.name, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return Response.json({ ok: true });
}
