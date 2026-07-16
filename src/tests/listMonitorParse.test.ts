import { describe, it, expect } from "vitest";
import { parseTwitterListId } from "../services/listMonitorPoller.js";

describe("parseTwitterListId", () => {
  it("accepts bare numeric id", () => {
    expect(parseTwitterListId("1941234567890")).toBe("1941234567890");
  });

  it("parses x.com/i/lists URL", () => {
    expect(parseTwitterListId("https://x.com/i/lists/1941234567890")).toBe(
      "1941234567890",
    );
    expect(parseTwitterListId("https://twitter.com/i/lists/1941234567890?s=20")).toBe(
      "1941234567890",
    );
  });

  it("parses named list URLs with trailing id", () => {
    expect(
      parseTwitterListId("https://x.com/someuser/lists/my-list-1941234567890"),
    ).toBe("1941234567890");
  });

  it("rejects junk", () => {
    expect(parseTwitterListId("")).toBeNull();
    expect(parseTwitterListId("not-a-list")).toBeNull();
    expect(parseTwitterListId("123")).toBeNull(); // too short
  });
});
