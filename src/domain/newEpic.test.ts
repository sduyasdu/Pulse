import { describe, expect, it } from "vitest";
import { isNewEpic } from "./layout";
import { EPIC_PALETTE } from "@/stores/pulseStore";

const DEFAULT = "New epic";
const CREATED = "#8B5CF6";

/** An epic as `addEpic` writes it: default name, auto colour, no tasks. */
const fresh = (over: Partial<Parameters<typeof isNewEpic>[0]> = {}) => ({
  name: DEFAULT,
  color: CREATED,
  initialColor: CREATED,
  count: 0,
  ...over,
});

const isNew = (e: Parameters<typeof isNewEpic>[0]) => isNewEpic(e, DEFAULT);

describe("a freshly created epic", () => {
  it("is new", () => {
    expect(isNew(fresh())).toBe(true);
  });
});

// Any ONE of these means someone has taken charge of the epic. An earlier rule
// required a name AND a task, which left a named, deliberately empty epic —
// a normal way to plan ahead — permanently shouting.
describe("any one sign of engagement ends it", () => {
  it("a name does", () => {
    expect(isNew(fresh({ name: "Billing" }))).toBe(false);
  });

  it("a colour change does", () => {
    expect(isNew(fresh({ color: "#EF4444" }))).toBe(false);
  });

  it("a task does", () => {
    expect(isNew(fresh({ count: 1 }))).toBe(false);
  });

  it("a named but deliberately empty epic is not new", () => {
    expect(isNew(fresh({ name: "Next quarter", count: 0 }))).toBe(false);
  });

  it("a recoloured but unnamed, empty epic is not new", () => {
    expect(isNew(fresh({ color: "#10B981", count: 0 }))).toBe(false);
  });
});

describe("what counts as named", () => {
  // The default is a placeholder the product wrote, not a name anyone chose.
  it("does not count the default name", () => {
    expect(isNew(fresh({ name: DEFAULT }))).toBe(true);
  });

  it("does not count blank or whitespace", () => {
    expect(isNew(fresh({ name: "" }))).toBe(true);
    expect(isNew(fresh({ name: "   " }))).toBe(true);
  });

  it("does not count the default with whitespace round it", () => {
    expect(isNew(fresh({ name: "  New epic  " }))).toBe(true);
  });

  it("counts a name that merely contains the default", () => {
    expect(isNew(fresh({ name: "New epic ideas" }))).toBe(false);
  });

  it("tolerates a missing name", () => {
    expect(isNew(fresh({ name: undefined }))).toBe(true);
    expect(isNew(fresh({ name: null }))).toBe(true);
  });
});

describe("what counts as recoloured", () => {
  it("does not count the colour it was created with", () => {
    expect(isNew(fresh({ color: CREATED, initialColor: CREATED }))).toBe(true);
  });

  // Epics written before `initialColor` existed have no baseline, so there is
  // nothing to compare and they read as never recoloured — which leaves them
  // behaving exactly as they did before the field was added.
  it("reads a legacy epic with no baseline as not recoloured", () => {
    expect(isNew({ name: DEFAULT, color: "#EF4444", initialColor: undefined, count: 0 })).toBe(true);
    expect(isNew({ name: DEFAULT, color: "#EF4444", initialColor: null, count: 0 })).toBe(true);
  });

  it("tolerates a missing colour", () => {
    expect(isNew({ name: DEFAULT, color: undefined, initialColor: CREATED, count: 0 })).toBe(true);
  });

  it("recognises every palette entry as a deliberate choice", () => {
    for (const c of EPIC_PALETTE.filter((c) => c !== CREATED)) {
      expect(isNew(fresh({ color: c })), c).toBe(false);
    }
  });
});

describe("the palette offered for recolouring", () => {
  it("gives a real choice", () => {
    expect(EPIC_PALETTE.length).toBeGreaterThanOrEqual(12);
  });

  it("has no duplicates, so two epics never look identical by accident", () => {
    expect(new Set(EPIC_PALETTE).size).toBe(EPIC_PALETTE.length);
  });

  it("is all valid hex, since the values go straight into CSS", () => {
    for (const c of EPIC_PALETTE) expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
