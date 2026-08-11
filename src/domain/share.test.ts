import { afterEach, describe, expect, it, vi } from "vitest";
import { canNativeShare, copyText, shareOrCopy } from "./share";

const PAYLOAD = { title: "Pulse", url: "https://pulse.app/p/1" };

/** jsdom ships neither navigator.share nor a working clipboard, so each test
 * installs exactly the capabilities it wants to exercise. */
function stubNavigator(props: Record<string, unknown>) {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
  }
}

function clearNavigator(...keys: string[]) {
  for (const key of keys) {
    Object.defineProperty(navigator, key, { value: undefined, configurable: true, writable: true });
  }
}

/** jsdom has no document.execCommand to spy on, so install one outright. */
function stubExecCommand(result: boolean) {
  const fn = vi.fn(() => result);
  Object.defineProperty(document, "execCommand", { value: fn, configurable: true, writable: true });
  return fn;
}

afterEach(() => {
  clearNavigator("share", "canShare", "clipboard");
  Reflect.deleteProperty(document, "execCommand");
  vi.restoreAllMocks();
});

describe("canNativeShare", () => {
  it("is false when the browser has no Web Share API", () => {
    clearNavigator("share");
    expect(canNativeShare(PAYLOAD)).toBe(false);
  });

  it("is true when share exists and canShare accepts the payload", () => {
    stubNavigator({ share: vi.fn(), canShare: vi.fn(() => true) });
    expect(canNativeShare(PAYLOAD)).toBe(true);
  });

  it("defers to canShare when it rejects the payload", () => {
    stubNavigator({ share: vi.fn(), canShare: vi.fn(() => false) });
    expect(canNativeShare(PAYLOAD)).toBe(false);
  });

  it("assumes shareable when canShare is missing (older Safari)", () => {
    stubNavigator({ share: vi.fn() });
    clearNavigator("canShare");
    expect(canNativeShare(PAYLOAD)).toBe(true);
  });
});

describe("shareOrCopy", () => {
  it("uses the share sheet when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share, clipboard: { writeText: vi.fn() } });
    expect(await shareOrCopy(PAYLOAD)).toBe("shared");
    expect(share).toHaveBeenCalledWith(PAYLOAD);
  });

  // The important one: dismissing the sheet must not silently copy instead.
  it("reports a dismissed sheet as cancelled and does not copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const abort = Object.assign(new Error("dismissed"), { name: "AbortError" });
    stubNavigator({ share: vi.fn().mockRejectedValue(abort), clipboard: { writeText } });
    expect(await shareOrCopy(PAYLOAD)).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to the clipboard when the share itself fails", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share: vi.fn().mockRejectedValue(new Error("no target")), clipboard: { writeText } });
    expect(await shareOrCopy(PAYLOAD)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(PAYLOAD.url);
  });

  it("copies when there is no share sheet at all", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    clearNavigator("share");
    stubNavigator({ clipboard: { writeText } });
    expect(await shareOrCopy(PAYLOAD)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(PAYLOAD.url);
  });

  it("reports failure when neither path works", async () => {
    clearNavigator("share");
    stubNavigator({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    stubExecCommand(false);
    expect(await shareOrCopy(PAYLOAD)).toBe("failed");
  });
});

describe("copyText", () => {
  it("uses the async clipboard when it works", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ clipboard: { writeText } });
    expect(await copyText("hello")).toBe(true);
  });

  it("falls back to execCommand when the clipboard is refused", async () => {
    stubNavigator({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const exec = stubExecCommand(true);
    expect(await copyText("hello")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("leaves no stray textarea behind after the fallback", async () => {
    stubNavigator({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    stubExecCommand(true);
    await copyText("hello");
    expect(document.querySelectorAll("textarea").length).toBe(0);
  });
});
