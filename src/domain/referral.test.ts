import { describe, expect, it } from "vitest";
import { REFERRAL_DAYS, forgetReferral, keepReferral, keptReferral } from "./referral";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
const DAY = 24 * 60 * 60 * 1000;

describe("the referral code kept from a link (TR9)", () => {
  it("keeps a code and reads it back", () => {
    const s = memory();
    expect(keepReferral("abcd2345", 0, s)).toBe(true);
    expect(keptReferral(DAY, s)).toBe("abcd2345");
  });

  it("reads a code typed in capitals as the code", () => {
    const s = memory();
    keepReferral("ABCD2345", 0, s);
    expect(keptReferral(0, s)).toBe("abcd2345");
  });

  it("keeps it for 60 days, then forgets it", () => {
    const s = memory();
    keepReferral("abcd2345", 0, s);
    expect(keptReferral(REFERRAL_DAYS * DAY, s)).toBe("abcd2345");
    expect(keptReferral(REFERRAL_DAYS * DAY + 1, s)).toBeNull();
    expect(keptReferral(0, s)).toBeNull(); // removed, not merely hidden
  });

  it("refuses a malformed code", () => {
    const s = memory();
    expect(keepReferral("short", 0, s)).toBe(false);
    expect(keepReferral("abcd234!", 0, s)).toBe(false);
    expect(keptReferral(0, s)).toBeNull();
  });

  it("forgets on request", () => {
    const s = memory();
    keepReferral("abcd2345", 0, s);
    forgetReferral(s);
    expect(keptReferral(0, s)).toBeNull();
  });

  it("survives storage that throws", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
    expect(keepReferral("abcd2345", 0, broken)).toBe(false);
    expect(keptReferral(0, broken)).toBeNull();
    expect(() => forgetReferral(broken)).not.toThrow();
  });
});
