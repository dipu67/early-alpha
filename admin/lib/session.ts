// Session — a stateless, HMAC-signed cookie carrying the logged-in user's claims
// (a JWT-equivalent: `<base64url(json)>.<hex sig>`), signed with SESSION_SECRET
// via Web Crypto. No server-side session store; the signature is the trust.

import { cookies } from "next/headers";
import type { Role } from "./rbac";

const COOKIE_NAME = "ea_admin_session";
const MAX_AGE_S = 60 * 60 * 12; // 12h

export interface SessionClaims {
  uid: string;
  email: string;
  role: Role;
  iat: number; // issued-at ms
}

function secretKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Missing SESSION_SECRET");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}
function b64urlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

async function sign(payload: string): Promise<string> {
  const key = await secretKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toHex(sig);
}

/** Build a signed cookie value from claims (iat stamped now). */
export async function createSessionValue(
  claims: Omit<SessionClaims, "iat">,
): Promise<string> {
  const full: SessionClaims = { ...claims, iat: Date.now() };
  const body = b64urlEncode(JSON.stringify(full));
  const sig = await sign(body);
  return `${body}.${sig}`;
}

/** Verify a cookie value and return its claims, or null if invalid/expired. */
export async function readSessionValue(value: string | undefined): Promise<SessionClaims | null> {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (sig !== (await sign(body))) return null;
  try {
    const claims = JSON.parse(b64urlDecode(body)) as SessionClaims;
    if (typeof claims.iat !== "number") return null;
    if (Date.now() - claims.iat >= MAX_AGE_S * 1000) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Read + verify the current request's session. */
export async function getSession(): Promise<SessionClaims | null> {
  const store = await cookies();
  return readSessionValue(store.get(COOKIE_NAME)?.value);
}

export const sessionCookie = {
  name: COOKIE_NAME,
  maxAge: MAX_AGE_S,
};
