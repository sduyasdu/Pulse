import { describe, expect, it } from "vitest";
import { cleanCycles, stripUndefined } from "./patch";

describe("stripUndefined", () => {
  it("drops undefined values so Firestore's updateDoc doesn't reject the whole write", () => {
    // Regression: unassignResource built `{ resources, alloc, lead }` where
    // `lead` was `undefined` whenever the feature had no team leader.
    // updateDoc() throws on undefined rather than ignoring it, so the entire
    // write failed — and because the caller was fire-and-forget, the ✕
    // button in the details panel just silently did nothing.
    expect(stripUndefined({ resources: [], alloc: {}, lead: undefined })).toEqual({ resources: [], alloc: {} });
  });

  it("keeps null, which is how a field is actually cleared", () => {
    expect(stripUndefined({ lead: null, estEffort: null })).toEqual({ lead: null, estEffort: null });
  });

  it("keeps falsy values that are not undefined", () => {
    expect(stripUndefined({ x: 0, title: "", ai: false })).toEqual({ x: 0, title: "", ai: false });
  });
});

describe("cleanCycles", () => {
  it("drops the nested undefined a rename leaves behind", () => {
    // Regression: renaming a seeded cycle or stage sets `i18nKey: undefined`
    // (SCT4), and updateDoc rejected the whole cycles write — "That change
    // didn't save", with colour and name changes lost together.
    const out = cleanCycles([{ id: "c", name: "Mine", i18nKey: undefined, statuses: [{ id: "s", label: "Mine", color: "#F5A524", i18nKey: undefined }] }]);
    expect(out).toEqual([{ id: "c", name: "Mine", statuses: [{ id: "s", label: "Mine", color: "#F5A524" }] }]);
    expect(JSON.stringify(out)).not.toContain("i18nKey");
    expect(Object.keys(out[0])).not.toContain("i18nKey");
    expect(Object.keys(out[0].statuses[0])).not.toContain("i18nKey");
  });
});
