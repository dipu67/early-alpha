import { describe, it, expect } from "vitest";
import {
  nextWatermark,
  toSnowflake,
  maxSnowflake,
  filterNewerThan,
  isDuplicateKeyError,
} from "../services/pollerCore.js";
import { Prisma } from "../generated/prisma/client.js";
import type { TweetData } from "../TwitterClient/types.js";

// Snowflake ids are 19 digits; keep them realistic so BigInt comparison is
// exercised rather than small-number coincidences.
const OLD = "1800000000000000000";
const MID = "1800000000000000500";
const NEW = "1800000000000000900";

describe("nextWatermark", () => {
  it("advances to the newest processed id when everything succeeded", () => {
    expect(
      nextWatermark({
        previous: OLD,
        processedIds: [MID, NEW],
        pageNewest: NEW,
        failedCount: 0,
      }),
    ).toBe(NEW);
  });

  // This is the data-loss regression. Before the fix the watermark jumped to
  // pageNewest even though a write had failed, so those tweets fell behind the
  // watermark and were never polled again.
  it("does NOT advance when an item failed to persist", () => {
    expect(
      nextWatermark({
        previous: OLD,
        processedIds: [],
        pageNewest: NEW,
        failedCount: 1,
      }),
    ).toBeNull();
  });

  it("holds position even if some items succeeded alongside a failure", () => {
    expect(
      nextWatermark({
        previous: OLD,
        processedIds: [MID],
        pageNewest: NEW,
        failedCount: 1,
      }),
    ).toBeNull();
  });

  it("treats duplicate-key skips as processed and still advances", () => {
    // Callers classify P2002 as processed, so failedCount stays 0.
    expect(
      nextWatermark({
        previous: OLD,
        processedIds: [MID, NEW],
        pageNewest: NEW,
        failedCount: 0,
      }),
    ).toBe(NEW);
  });

  it("never moves backwards", () => {
    expect(
      nextWatermark({
        previous: NEW,
        processedIds: [OLD, MID],
        pageNewest: MID,
        failedCount: 0,
      }),
    ).toBeNull();
  });

  it("returns null when the watermark would not change", () => {
    expect(
      nextWatermark({
        previous: NEW,
        processedIds: [NEW],
        pageNewest: NEW,
        failedCount: 0,
      }),
    ).toBeNull();
  });

  it("tolerates unparseable ids without advancing to garbage", () => {
    expect(
      nextWatermark({
        previous: OLD,
        processedIds: ["not-a-snowflake", null, undefined],
        pageNewest: "also-garbage",
        failedCount: 0,
      }),
    ).toBeNull();
  });

  it("seeds from nothing when there is no previous watermark", () => {
    expect(
      nextWatermark({
        previous: null,
        processedIds: [OLD, NEW],
        pageNewest: NEW,
        failedCount: 0,
      }),
    ).toBe(NEW);
  });
});

describe("toSnowflake", () => {
  it("returns null rather than 0n for garbage", () => {
    // 0n would compare as older than everything, making all tweets look new.
    expect(toSnowflake("nope")).toBeNull();
    expect(toSnowflake("")).toBeNull();
    expect(toSnowflake(null)).toBeNull();
    expect(toSnowflake(undefined)).toBeNull();
  });

  it("parses real ids", () => {
    expect(toSnowflake(NEW)).toBe(BigInt(NEW));
  });
});

describe("maxSnowflake", () => {
  it("compares numerically, not lexicographically", () => {
    // "9..." > "10..." as strings, but 10 > 9 numerically.
    expect(maxSnowflake(["9000000000000000000", "10000000000000000000"])).toBe(
      "10000000000000000000",
    );
  });

  it("skips unparseable entries and returns null when none parse", () => {
    expect(maxSnowflake([null, "x", undefined])).toBeNull();
    expect(maxSnowflake([null, "x", MID])).toBe(MID);
  });
});

describe("filterNewerThan", () => {
  const tweet = (id: string): TweetData => ({ id } as TweetData);

  it("returns nothing when there is no watermark (first-run seeding)", () => {
    expect(filterNewerThan([tweet(OLD), tweet(NEW)], null)).toEqual([]);
  });

  it("keeps only ids strictly greater than the watermark", () => {
    const got = filterNewerThan([tweet(OLD), tweet(MID), tweet(NEW)], MID);
    expect(got.map((t) => t.id)).toEqual([NEW]);
  });

  it("does not assume page order", () => {
    const got = filterNewerThan([tweet(NEW), tweet(OLD)], MID);
    expect(got.map((t) => t.id)).toEqual([NEW]);
  });
});

describe("isDuplicateKeyError", () => {
  it("recognizes P2002 only", () => {
    const dup = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "test",
    });
    const other = new Prisma.PrismaClientKnownRequestError("boom", {
      code: "P1001",
      clientVersion: "test",
    });
    expect(isDuplicateKeyError(dup)).toBe(true);
    expect(isDuplicateKeyError(other)).toBe(false);
  });

  it("does not treat plain errors as duplicates", () => {
    // A connection reset must never be mistaken for a dedupe.
    expect(isDuplicateKeyError(new Error("ECONNRESET"))).toBe(false);
    expect(isDuplicateKeyError(undefined)).toBe(false);
  });
});
