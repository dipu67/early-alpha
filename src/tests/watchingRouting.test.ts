import { describe, expect, it } from "vitest";
import { routeWatchingTweet, type WatchingRouting } from "../services/watchingPoller.js";

const BOTH_ON: WatchingRouting = {
  signalEnabled: true,
  rowEnabled: true,
  signalTopicId: 3362,
  rowTopicId: 8333,
};

describe("routeWatchingTweet", () => {
  it("sends a post with signals to the signal topic", () => {
    expect(routeWatchingTweet(["mint live"], BOTH_ON)).toEqual({
      branch: "signal",
      enabled: true,
      topicId: 3362,
    });
  });

  it("sends a post with no signals to the row-post topic", () => {
    expect(routeWatchingTweet([], BOTH_ON)).toEqual({
      branch: "row",
      enabled: true,
      topicId: 8333,
    });
  });

  it("routes each branch independently — one topic is never used for both", () => {
    const signal = routeWatchingTweet(["tge"], BOTH_ON);
    const row = routeWatchingTweet([], BOTH_ON);
    expect(signal.topicId).not.toBe(row.topicId);
  });

  it("reports a branch as disabled without stealing the other branch's traffic", () => {
    const rowOff: WatchingRouting = { ...BOTH_ON, rowEnabled: false };
    // A plain post is dropped...
    expect(routeWatchingTweet([], rowOff)).toEqual({
      branch: "row",
      enabled: false,
      topicId: 8333,
    });
    // ...while signals still flow. A disabled row must not silently reroute
    // plain posts into the signal topic.
    expect(routeWatchingTweet(["mint live"], rowOff).enabled).toBe(true);

    const signalOff: WatchingRouting = { ...BOTH_ON, signalEnabled: false };
    expect(routeWatchingTweet(["mint live"], signalOff).enabled).toBe(false);
    expect(routeWatchingTweet([], signalOff).enabled).toBe(true);
  });

  it("leaves topicId undefined when the admin has not picked a topic", () => {
    const unset: WatchingRouting = {
      signalEnabled: true,
      rowEnabled: true,
      signalTopicId: undefined,
      rowTopicId: undefined,
    };
    // undefined defers to sendTelegramAlert's alert-type / default topic
    // rather than dropping the alert.
    expect(routeWatchingTweet(["mint live"], unset).topicId).toBeUndefined();
    expect(routeWatchingTweet([], unset).topicId).toBeUndefined();
  });
});
