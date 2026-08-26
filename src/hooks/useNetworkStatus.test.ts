import { describe, expect, it } from "vitest";
import { networkStatusOf } from "./useNetworkStatus";

describe("network status precedence", () => {
  it("is online when the browser has a network and the server answers", () => {
    expect(networkStatusOf(true, true)).toBe("online");
  });

  it("is offline when the device reports no network", () => {
    expect(networkStatusOf(false, true)).toBe("offline");
  });

  // The case navigator.onLine cannot see, and the one people actually describe
  // as "the wifi is connected but nothing works": captive portal, dead
  // upstream, dropped VPN. The browser calls all three online.
  it("is unreachable when there's a network but Firestore isn't answering", () => {
    expect(networkStatusOf(true, false)).toBe("unreachable");
  });

  // More specific fact, simpler instruction. If the device is off the network
  // entirely, saying "we can't reach the server" buries the lede.
  it("prefers offline over unreachable when both are true", () => {
    expect(networkStatusOf(false, false)).toBe("offline");
  });

  // A banner that flashed on every page load, while the probe's first snapshot
  // was still in flight, would train people to ignore it.
  it("says nothing while the probe has yet to report", () => {
    expect(networkStatusOf(true, null)).toBe("online");
  });

  it("still reports a genuinely offline device before the probe reports", () => {
    expect(networkStatusOf(false, null)).toBe("offline");
  });
});
