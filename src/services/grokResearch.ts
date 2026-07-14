// Grok research: render special prompts over selected projects and call Grok.

import { prisma } from "../db/prisma.js";
import { getTwitterClient } from "../twitter/getClient.js";

export const PROMPT_PLACEHOLDERS = [
  "{{tag}}",
  "{{count}}",
  "{{handles}}",
  "{{projects}}",
] as const;

export type ProjectForResearch = {
  id: string;
  username: string;
  name: string;
  description: string | null;
  tags: string[];
  followersCount: number | null;
};

/**
 * Built-in special prompts — tuned for high-signal Grok research output.
 * Seeded / refreshed via ensureBuiltinPrompts() or POST /api/grok/prompts/seed.
 */
export const BUILTIN_PROMPTS: {
  slug: string;
  name: string;
  description: string;
  defaultTag: string | null;
  template: string;
}[] = [
  {
    slug: "nft-deep-dive",
    name: "NFT · Deep dive",
    description:
      "Best default for NFT tags: clusters, top watches, mint/TGE catalysts, risks, searches.",
    defaultTag: "nft",
    template: `You are a senior NFT / digital-collectibles alpha researcher for an early-stage tracking desk.

## Rules (non-negotiable)
- Be skeptical. No hype language. Mark unknowns as **unknown** — never invent mints, valuations, or team names.
- Cite only what is inferable from bios/handles/public positioning in the list below.
- Prefer ranked lists + tables. Markdown only. Tight bullets (max ~12 words each unless a one-liner thesis).
- Always use @handles when naming projects.

## Universe
Tag filter: **{{tag}}**
Count: **{{count}}**
Handles: {{handles}}

### Project cards
{{projects}}

## Deliverable (use these exact section headers)

### 1. Cluster map
Group projects into 3–6 clusters (e.g. PFPs, gaming NFTs, mint infra, marketplaces, art, IP, consumer). One sentence per cluster on the shared bet.

### 2. Priority table
| Rank | @handle | Cluster | Thesis (≤20 words) | Catalyst type | Risk flag | Action |
|---|---|---|---|---|---|---|
(Action ∈ follow hard / soft watch / skip)

Rank top **min(8, n)** by asymmetric upside × narrative timing (not follower count).

### 3. Mint & liquidity radar
For any project that might mint / WL / open edition / marketplace soon:
- What would confirmation look like on Twitter?
- What would be a hard pass signal?

### 4. Red team
List the 3 most likely traps in this set (farm, vaporware, paid engagement, recycled brand).

### 5. Validation pack
5 Twitter search operators or account types to confirm real traction (not vanity metrics).

### 6. Single bet
If forced to pick ONE @handle for the next 30 days: name + 3 bullets why + 1 kill-criterion.

End with: **Confidence:** low | medium | high — and why.`,
  },
  {
    slug: "nft-mint-wl",
    name: "NFT · Mint / WL hunter",
    description:
      "Optimized for free mint, WL, mint live, supply games — what to farm vs ignore.",
    defaultTag: "nft",
    template: `You are a mint / whitelist hunter who only wants convex, low-time-waste opportunities.

## Rules
- Assume most mints are noise. Filter hard.
- No invented dates or supply numbers. Use **unknown** if not in data.
- Output must be scannable in 60 seconds.

## Set
Tag: {{tag}} · n={{count}}
{{projects}}

Handles: {{handles}}

## Output

### A. Tier list
- **S — act now** (if any)
- **A — prepare WL / alerts**
- **B — watch thread only**
- **C — ignore**

For each S/A name: @handle · why · what alert to set · what would invalidate.

### B. Farm hygiene
Checklist of 6 red flags for this batch (bot followers, no art, endless delay, points meta, etc.).

### C. Alert recipes
5 concrete Twitter search strings tailored to THIS set (use project names/handles where useful).

### D. One sentence desk note
What the market is doing with these names right now (speculation only if labeled as such).`,
  },
  {
    slug: "defi-protocol-scan",
    name: "DeFi · Protocol scan",
    description: "Segment DeFi names, rank asymmetric upside, surface farm risks.",
    defaultTag: "defi",
    template: `You are a DeFi protocol screener for an early alpha desk (pre- and early-token).

## Rules
- Separate product reality from narrative.
- Call out points/farm meta and empty TVL cosplay.
- Markdown tables preferred. @handles only.

## Universe
Tag: **{{tag}}** · Count: **{{count}}**
{{projects}}

Handles: {{handles}}

## Deliverable

### 1. Segmentation
| @handle | Segment | Product hypothesis | Token status (guess: none/points/live/unknown) | Main risk |

Segments: DEX, lending, perps, restaking, LRT, yield, stable, bridge, infra, other.

### 2. Ranking (top 5)
Asymmetric upside if narrative holds — not market cap cosplay. 2 bullets each.

### 3. Contagion & correlation
Which names move together? Which is a pure narrative proxy?

### 4. Farm vs product
Names that look like mercenary points vs names with sticky use-cases.

### 5. Desk actions
follow / list / deep-dive / pass — one line each for top 8.

### 6. Kill list
Bottom 3 with blunt reason.

**Confidence:** low | medium | high.`,
  },
  {
    slug: "gamefi-scan",
    name: "GameFi · Play & earn scan",
    description: "Game/studio projects: funnel, token trap, retention skepticism.",
    defaultTag: "gamefi",
    template: `You are a GameFi / web3 games analyst allergic to vaporware trailers.

## Rules
- Shipping > lore. If no ship signal, say so.
- Token-first games get harsh scores.

## Set
Tag: {{tag}} · n={{count}}
{{projects}}
Handles: {{handles}}

## Output

### Matrix
| @handle | Genre | Stage (idea/alpha/live/unknown) | Fun | Token trap risk | Watch? |

### Top 3 to track
Thesis + what "alive" looks like in 30 days.

### Skip pile
Who is pure art/roadmap with no game.

### Social proof tests
5 things to verify (steam, playtest, content creators, onchain players — only as checklist).

### Single pick
@handle + why + kill switch.

Markdown only.`,
  },
  {
    slug: "ai-agent-scan",
    name: "AI · Agents & infra scan",
    description: "AI/agent/crypto infra: real product vs AI wrapper narrative.",
    defaultTag: "ai",
    template: `You are screening crypto × AI projects (agents, models, infra, data).

## Rules
- "AI" in bio is not a product. Demand a concrete loop: user → action → value.
- Punish generic LLM wrappers.

## Set
Tag: {{tag}} · n={{count}}
{{projects}}
Handles: {{handles}}

## Deliverable

### Taxonomy
agent | model | infra | data | consumer | vapor

### Scorecard (0–5 each)
| @handle | Specificity | Moat claim | Crypto-necessity | Hype ratio | Total |

Crypto-necessity = why this needs a token/chain at all.

### Winners & losers
Top 3 / bottom 3 with one brutal sentence each.

### Research next steps
Who to follow, what metrics, what would flip conviction.

Markdown.`,
  },
  {
    slug: "meme-narrative",
    name: "Meme · Narrative velocity",
    description: "Meme coins / culture coins: velocity, fatigue, contagion.",
    defaultTag: "meme",
    template: `You analyze meme / culture coins as narrative assets (not fundamentals cosplay).

## Set
Tag: {{tag}} · n={{count}}
{{projects}}
Handles: {{handles}}

## Output
1. **Meta** — what meme season pattern this set looks like.
2. **Velocity ranking** — who can go vertical vs already exhausted (label speculation).
3. **Contagion map** — which names pump together.
4. **Danger** — rugs, dev dumps, clone farms (generic patterns OK).
5. **Trade hygiene** — position sizing mindset + invalidation (non-financial advice framing).
6. **Ignore list** — dead narratives.

Keep it sharp. Markdown.`,
  },
  {
    slug: "l1-l2-infra",
    name: "Chain · L1/L2/infra",
    description: "Chains and infra: differentiation, ecosystem bet, zombie risk.",
    defaultTag: "chain",
    template: `You research L1/L2/infra projects for ecosystem optionality.

## Set
Tag: {{tag}} · n={{count}}
{{projects}}
Handles: {{handles}}

## Deliverable
| @handle | Layer | Differentiator claim | Ecosystem dependency | Zombie risk | Watch |

Then:
- Best long-tail ecosystem bet
- Pure marketing chain
- What builders would need to show up
- 4 validation searches

Markdown. Skeptical.`,
  },
  {
    slug: "alpha-comparison",
    name: "Alpha · Head-to-head matrix",
    description: "Any tag: blunt comparison matrix + best risk/reward.",
    defaultTag: null,
    template: `You are an early-crypto alpha hunter comparing a shortlist under time pressure.

## Rules
- Blunt. No diplomacy.
- Follower count is vanity — de-weight it unless it enables distribution.

## Set
Tag context: {{tag}} · n={{count}}
{{projects}}
Handles: {{handles}}

## Matrix
| @handle | Category | Strength | Weakness | Narrative fit (1–5) | Watch? |

## Calls
1. Best risk/reward  
2. Most underrated  
3. Overhyped / skip  
4. Three questions for the team/community  
5. One portfolio barbell (safe-ish + lottery)

Markdown only.`,
  },
  {
    slug: "early-scorecard",
    name: "Alpha · Early project scorecard",
    description:
      "0–100 scoring across team signal, narrative, distribution, execution — best generalist prompt.",
    defaultTag: null,
    template: `Score early crypto projects like a disciplined scout.

## Scoring dimensions (0–20 each → total /100)
1. Narrative clarity  
2. Distribution (audience quality, not raw followers)  
3. Product/shipping signal  
4. Differentiated angle  
5. Risk of being a farm/scam  

## Set
Tag: {{tag}} · n={{count}}
{{projects}}
Handles: {{handles}}

## Output
### Score table
| @handle | N | D | P | Diff | Risk↓ | Total | Grade |

Grade: A/B/C/D/F. Risk↓ means higher score = safer (invert risk).

### Top quartile deep notes
2–3 sentences each.

### Auto-rejects
Anyone under 40 total — one line why.

### Watchlist recommendation
"Core" vs "Lottery" vs "Pass" buckets with @handles.

Be consistent across rows. Markdown.`,
  },
  {
    slug: "red-team-scam",
    name: "Risk · Red team / scam filter",
    description: "Adversarial pass: social engineering, rugs, engagement traps.",
    defaultTag: null,
    template: `You are a security-minded red teamer reviewing early project accounts for social risk.

## Set
Tag: {{tag}} · n={{count}}
{{projects}}
Handles: {{handles}}

## For each project (compact)
- Impersonation risk
- Engagement bait patterns
- Unrealistic claims in bio
- Trust score 1–5 (5 = cleaner)

## Then
1. **Do not interact** list  
2. **Verify before follow** list  
3. **Relatively clean** list  
4. Desk policy: 5 rules when researching unknowns from this tag

Never accuse crimes; speak in risk language. Markdown.`,
  },
  {
    slug: "smart-money-angle",
    name: "Alpha · Smart-money angle",
    description: "What sophisticated money would care about; who is tourist bait.",
    defaultTag: null,
    template: `Think like a smart-money crypto scout (funds, serious angels, onchain natives).

## Set
Tag: {{tag}} · n={{count}}
{{projects}}
Handles: {{handles}}

## Deliverable
1. **Institutional-grade interesting** (if any) — why  
2. **Retail tourist bait** — why  
3. **Information edge** — what data would change the view  
4. **Who else should be following these** (archetypes, not real people)  
5. **30-day monitoring plan** (metrics + social)

Markdown. No cheerleading.`,
  },
  {
    slug: "weekly-watchlist",
    name: "Ops · Weekly watchlist brief",
    description: "Paste-ready weekly brief for Telegram/ops: ranks, alerts, ignores.",
    defaultTag: null,
    template: `Write an ops-ready weekly watchlist brief for an early-alpha Telegram desk.

## Input
Tag: {{tag}} · n={{count}}
{{projects}}
Handles: {{handles}}

## Format (exact)

**Weekly brief — {{tag}} — {{count}} names**

### 🔥 Active watch (max 5)
- @handle — trigger to re-check

### 👀 Soft watch (max 5)
- @handle — note

### 💤 Parked
- comma-separated @handles

### 🚨 Alerts to configure
1. …
2. …

### 📌 Desk note (3 sentences max)

Tone: operator, not influencer. Markdown.`,
  },
  {
    slug: "custom-blank",
    name: "Custom · Blank scaffold",
    description: "Minimal scaffold — edit and Save as your own special prompt.",
    defaultTag: null,
    template: `You are an early-crypto research analyst.

## Context
Tag: {{tag}}
Count: {{count}}
Handles: {{handles}}

## Projects
{{projects}}

## Task
(Write your instructions here — be specific about sections, ranking, and skepticism.)

## Output rules
- Markdown only
- Use @handles
- Mark unknowns as unknown
- Prefer tables for comparisons`,
  },
];

export function formatProjectsBlock(projects: ProjectForResearch[]): string {
  return projects
    .map((p, i) => {
      const bio = (p.description ?? "").replace(/\s+/g, " ").trim();
      const bioShort = bio.length > 180 ? `${bio.slice(0, 177)}…` : bio;
      const tags = p.tags.length ? p.tags.join(", ") : "—";
      const fol =
        p.followersCount != null ? p.followersCount.toLocaleString() : "?";
      return [
        `${i + 1}. @${p.username} — ${p.name || "(no name)"}`,
        `   id: ${p.id} · followers: ${fol} · tags: ${tags}`,
        bioShort ? `   bio: ${bioShort}` : "   bio: (empty)",
      ].join("\n");
    })
    .join("\n");
}

export function renderResearchPrompt(
  template: string,
  vars: {
    tag: string;
    projects: ProjectForResearch[];
  },
): string {
  const handles = vars.projects.map((p) => `@${p.username}`).join(", ");
  const projectsBlock = formatProjectsBlock(vars.projects);
  return template
    .replaceAll("{{tag}}", vars.tag || "any")
    .replaceAll("{{count}}", String(vars.projects.length))
    .replaceAll("{{handles}}", handles || "(none)")
    .replaceAll("{{projects}}", projectsBlock || "(no projects selected)");
}

/**
 * Upsert all built-in special prompts into the DB.
 * Builtins are always refreshed (name/description/template/defaultTag) so
 * "Seed special prompts" in the admin Tools panel ships improved copy.
 * Custom (non-builtin) rows are never touched.
 */
export async function ensureBuiltinPrompts(): Promise<{
  upserted: number;
  slugs: string[];
}> {
  const slugs: string[] = [];
  for (const p of BUILTIN_PROMPTS) {
    await prisma.grokResearchPrompt.upsert({
      where: { slug: p.slug },
      create: {
        slug: p.slug,
        name: p.name,
        description: p.description,
        template: p.template,
        defaultTag: p.defaultTag,
        isBuiltin: true,
      },
      update: {
        name: p.name,
        description: p.description,
        template: p.template,
        defaultTag: p.defaultTag,
        isBuiltin: true,
      },
    });
    slugs.push(p.slug);
  }
  return { upserted: slugs.length, slugs };
}

export async function loadProjectsByIds(
  ids: string[],
): Promise<ProjectForResearch[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.twitterAccount.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      username: true,
      name: true,
      description: true,
      tags: true,
      followersCount: true,
    },
  });
  // Preserve selection order
  const map = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => map.get(id)).filter(Boolean) as ProjectForResearch[];
}

export async function loadProjectsByTag(
  tag: string,
  limit = 40,
): Promise<ProjectForResearch[]> {
  const t = tag.trim().toLowerCase();
  if (!t) return [];
  return prisma.twitterAccount.findMany({
    where: { tags: { has: t } },
    orderBy: { followersCount: { sort: "desc", nulls: "last" } },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      username: true,
      name: true,
      description: true,
      tags: true,
      followersCount: true,
    },
  });
}

export async function runGrokResearch(opts: {
  promptId?: bigint | null;
  template: string;
  tag: string;
  projectIds: string[];
  title?: string | null | undefined;
}): Promise<{
  runId: bigint;
  status: string;
  response: string | null;
  error: string | null;
  renderedPrompt: string;
  grokConversationId: string | null;
}> {
  const projects = await loadProjectsByIds(opts.projectIds);
  if (projects.length === 0) {
    throw new Error("no_projects");
  }

  const renderedPrompt = renderResearchPrompt(opts.template, {
    tag: opts.tag,
    projects,
  });

  const run = await prisma.grokResearchRun.create({
    data: {
      promptId: opts.promptId ?? null,
      title:
        opts.title ??
        `${opts.tag || "research"} · ${projects.length} projects · ${new Date().toISOString().slice(0, 16)}`,
      tag: opts.tag || null,
      projectIds: projects.map((p) => p.id),
      projectHandles: projects.map((p) => p.username),
      renderedPrompt,
      status: "pending",
    },
  });

  try {
    const { client } = await getTwitterClient();
    const conv = await client.createGrokConversation();
    if (!conv.success || !conv.conversationId) {
      throw new Error(conv.error ?? "failed_to_create_conversation");
    }

    const res = await client.sendGrokMessage({
      message: renderedPrompt,
      conversationId: conv.conversationId,
      options: { modelMode: "MODEL_MODE_NORMAL" },
    });

    if (!res.success || !res.message) {
      throw new Error(res.error ?? "grok_empty_response");
    }

    await prisma.grokResearchRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        response: res.message,
        grokConversationId: conv.conversationId,
        completedAt: new Date(),
      },
    });

    return {
      runId: run.id,
      status: "success",
      response: res.message,
      error: null,
      renderedPrompt,
      grokConversationId: conv.conversationId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.grokResearchRun.update({
      where: { id: run.id },
      data: {
        status: "error",
        error: message,
        completedAt: new Date(),
      },
    });
    return {
      runId: run.id,
      status: "error",
      response: null,
      error: message,
      renderedPrompt,
      grokConversationId: null,
    };
  }
}
