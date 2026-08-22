// Project enrichment service — derives chain from bio text.
// Categories are derived from tags (not bio), so use classifyAccount + tagsToCategories.

import { CHAIN_SLUGS, tagLabel } from "./projectTagger.js";

/** Well-known chain candidates checked in bio+username text. */
const CHAIN_CANDIDATES = [
  "ethereum", "eth", "solana", "sol", "arbitrum", "arb",
  "optimism", "op", "base", "zksync", "polygon", "matic",
  "bsc", "bnb", "avalanche", "avax", "near", "sui", "aptos",
  "cosmos", "ibc", "blast", "mode", "mantle", "linea", "scroll",
  "robinhood", "rcoin",
  "arc", "arcdao",
];

export interface EnrichResult {
  chain: string | null;
}

/**
 * Derive chain slug from bio + username text.
 * Categories are NOT derived here — use tagsToCategories() from projectTagger.js
 * which maps tag slugs → category labels consistently.
 */
export function enrichFromBio(bio: string | null | undefined, username: string): EnrichResult {
  const text = ((bio ?? "") + " " + username).toLowerCase();
  let chain: string | null = null;

  for (const candidate of CHAIN_CANDIDATES) {
    if (new RegExp(`\\b${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) {
      const label = tagLabel(candidate);
      if (CHAIN_SLUGS.has(candidate)) {
        chain = candidate;
      } else if (CHAIN_SLUGS.has(label)) {
        chain = label;
      } else {
        chain = candidate;
      }
      break;
    }
  }

  return { chain };
}
