import { describe, expect, it } from "vitest";
import { stripUndefined } from "./patch";

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
