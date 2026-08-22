"use client";

import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import type { ProjectSort } from "@/lib/types";

const SORT_OPTIONS: { value: ProjectSort; label: string }[] = [
  { value: "latest", label: "Latest (newest first)" },
  { value: "oldest", label: "Oldest first" },
  { value: "followers", label: "Most followers" },
  { value: "followers_asc", label: "Fewest followers" },
  { value: "updated", label: "Recently updated" },
  { value: "username", label: "Username A–Z" },
];

const CATEGORIES = ["DeFi", "NFT", "L1", "L2", "GameFi", "AI", "Infra", "Social", "Other"];
const STATUSES = ["discovered", "investigating", "watching", "launched", "archived"];

function buildHref(parts: {
  search?: string;
  sort?: string;
  missingBioOnly?: boolean;
  category?: string;
  projectStatus?: string;
  chain?: string;
}): string {
  const params = new URLSearchParams();
  if (parts.search?.trim()) params.set("search", parts.search.trim());
  if (parts.sort && parts.sort !== "latest") params.set("sort", parts.sort);
  if (parts.missingBioOnly) params.set("missingBio", "1");
  if (parts.category) params.set("category", parts.category);
  if (parts.projectStatus) params.set("projectStatus", parts.projectStatus);
  if (parts.chain) params.set("chain", parts.chain);
  const q = params.toString();
  return q ? `/dashboard/projects?${q}` : "/dashboard/projects";
}

export function ProjectsFilters({
  search,
  sort,
  total,
  missingBioOnly = false,
  missingBioCount = 0,
  category: initialCategory,
  status: initialStatus,
  chain: initialChain,
  chains,
}: {
  search: string;
  sort: ProjectSort;
  total: number;
  missingBioOnly?: boolean;
  missingBioCount?: number;
  category?: string;
  status?: string;
  chain?: string;
  chains?: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState(initialCategory ?? "");
  const [status, setStatus] = useState(initialStatus ?? "");
  const [chain, setChain] = useState(initialChain ?? "");

  function navigate(next: {
    search?: string;
    sort?: string;
    missingBioOnly?: boolean;
    category?: string;
    status?: string;
    chain?: string;
  }) {
    startTransition(() => {
      router.push(
        buildHref({
          search: next.search ?? search,
          sort: next.sort ?? sort,
          missingBioOnly: next.missingBioOnly ?? missingBioOnly,
          category: next.category ?? (category || undefined),
          projectStatus: next.status ?? (status || undefined),
          chain: next.chain ?? (chain || undefined),
        }),
      );
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    navigate({
      search: String(fd.get("search") ?? ""),
      sort: String(fd.get("sort") ?? "latest") as ProjectSort,
    });
  }

  const hasFilters = Boolean(
    search || (sort && sort !== "latest") || missingBioOnly || category || status || chain,
  );

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
    >
      <Input
        name="search"
        defaultValue={search}
        placeholder="search username/name"
        className="h-9 w-full sm:w-56"
        key={`search-${search}`}
      />
      <select
        name="sort"
        value={sort}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as ProjectSort;
          navigate({ sort: next });
        }}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-ring sm:w-52"
        aria-label="Sort projects"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-ring sm:w-32"
      >
        <option value="">All categories</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-ring sm:w-36"
      >
        <option value="">All statuses</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <select
        value={chain}
        onChange={(e) => setChain(e.target.value)}
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-ring sm:w-32"
      >
        <option value="">All chains</option>
        {(chains || []).map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" className="h-9" disabled={pending}>
          {pending ? "Loading…" : "Apply"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={missingBioOnly ? "secondary" : "outline"}
          className="h-9"
          disabled={pending}
          onClick={() => navigate({ missingBioOnly: !missingBioOnly })}
        >
          No bio{missingBioCount > 0 ? ` (${missingBioCount})` : ""}
        </Button>
        {hasFilters ? (
          <Button type="button" variant="ghost" size="sm" className="h-9" asChild>
            <Link href="/dashboard/projects">Clear</Link>
          </Button>
        ) : null}
        <span className="text-sm text-muted-foreground">
          {total} total
          {pending ? " · updating…" : ""}
        </span>
      </div>
    </form>
  );
}
