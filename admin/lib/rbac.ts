// Role-based access control. Roles are ordered; a route requires a minimum role.
// The proxy enforces this server-side (real gate); the UI uses the same helpers
// to hide controls (cosmetic).

export type Role = "admin" | "editor" | "viewer";

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

export function isRole(x: string): x is Role {
  return x === "admin" || x === "editor" || x === "viewer";
}

/** True if `role` meets or exceeds `min`. */
export function atLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

/**
 * Minimum role required for a proxied backend call. GET is viewer-level
 * everywhere. Writes are editor-level, except user management and the
 * destructive list-delete, which are admin-only.
 */
export function requiredRoleFor(method: string, backendPath: string): Role {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return "viewer";

  // Admin-only surfaces.
  if (backendPath.startsWith("/api/users")) return "admin";
  if (backendPath.startsWith("/api/settings")) return "admin";
  if (backendPath.startsWith("/api/queues")) return "admin";
  if (backendPath.startsWith("/api/tg")) return "admin";
  if (backendPath.startsWith("/api/backup")) return "admin";
  if (backendPath.startsWith("/api/lists/delete")) return "admin";
  // Bulk wipe of all Grok chats is admin-only; single deletes stay editor.
  if (
    backendPath === "/api/grok/conversations" &&
    (m === "DELETE" || m === "POST")
  ) {
    return "admin";
  }

  // All other writes: editor.
  return "editor";
}

/** UI helper: can this role perform writes at all? */
export function canWrite(role: Role): boolean {
  return atLeast(role, "editor");
}

/** UI helper: is this role an admin? */
export function isAdmin(role: Role): boolean {
  return role === "admin";
}
