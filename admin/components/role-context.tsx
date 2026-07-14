"use client";

import { createContext, useContext } from "react";
import type { Role } from "@/lib/rbac";
import { atLeast } from "@/lib/rbac";

const RoleContext = createContext<Role>("viewer");

export function RoleProvider({ role, children }: { role: Role; children: React.ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useRole(): Role {
  return useContext(RoleContext);
}

/** True if the current role meets `min`. */
export function useCan(min: Role): boolean {
  return atLeast(useContext(RoleContext), min);
}
