"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
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

function buildHref(parts: {
  tag?: string;
  search?: string;
  sort?: string;
  missingBioOnly?: boolean;
}): string {
  const params = new URLSearchParams();
  if (parts.tag?.trim()) params.set("tag", parts.tag.trim());
  if (parts.search?.trim()) params.set("search", parts.search.trim());
  if (parts.sort && parts.sort !== "latest") params.set("sort", parts.sort);
  if (parts.missingBioOnly) params.set("missingBio", "1");
  const q = params.toString();
  return q ? `/dashboard/projects?${q}` : "/dashboard/projects";
}

export function ProjectsFilters({
  tag,
  search,
  sort,
  total,
  missingBioOnly = false,
  missingBioCount = 0,
}: {
  tag: string;
  search: string;
  sort: ProjectSort;
  total: number;
  missingBioOnly?: boolean;
  missingBioCount?: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function navigate(next: {
    tag?: string;
    search?: string;
    sort?: string;
    missingBioOnly?: boolean;
  }) {
    startTransition(() => {
      router.push(
        buildHref({
          tag: next.tag ?? tag,
          search: next.search ?? search,
          sort: next.sort ?? sort,
          missingBioOnly: next.missingBioOnly ?? missingBioOnly,
        }),
      );
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    navigate({
      tag: String(fd.get("tag") ?? ""),
      search: String(fd.get("search") ?? ""),
      sort: String(fd.get("sort") ?? "latest") as ProjectSort,
    });
  }

  const hasFilters = Boolean(
    tag || search || (sort && sort !== "latest") || missingBioOnly,
  );

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
    >
      <Input
        name="tag"
        defaultValue={tag}
        placeholder="tag slug"
        className="h-9 w-full sm:w-40"
        key={`tag-${tag}`}
      />
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
