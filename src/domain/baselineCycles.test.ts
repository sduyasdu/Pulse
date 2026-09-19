import { describe, expect, it } from "vitest";
import { BASELINE_CYCLES, CURRENT_SEED_VERSION, asCycles, cyclesToSeed } from "./baselineCycles";
import { DEFAULT_STATUSES, DONE_STATUS_ID, qualificationOf } from "./constants";

/**
 * The templates every workspace is offered.
 *
 * These are written into customer data and then copied into Beats, so a
 * mistake here is not a rendering bug — it is a wrong workflow in somebody's
 * project, already copied, with the template long since edited away from what
 * shipped.
 */
describe("the shape every template has to hold", () => {
  it("ends every cycle in exactly one Done", () => {
    // CY5/CY6. A template breaking this creates Beats whose final stage never
    // locks a task, never stamps finishedAt and never counts as complete.
    for (const c of BASELINE_CYCLES) {
      expect(c.statuses.filter((s) => s.id === DONE_STATUS_ID)).toHaveLength(1);
      expect(c.statuses[c.statuses.length - 1].id).toBe(DONE_STATUS_ID);
    }
  });

  it("gives every non-terminal stage an explicit qualification", () => {
    // CY16. Left unset it falls back to position — first is planned, the rest
    // ongoing — which would silently label every "On hold" stage as ongoing and
    // make the stalled report empty.
    for (const c of BASELINE_CYCLES) {
      for (const s of c.statuses.filter((x) => x.id !== DONE_STATUS_ID)) {
        expect(s.qualifies).toBeTruthy();
      }
    }
  });

  it("gives every template a stalled stage", () => {
    // The reason for asking: a cross-cycle "what is stuck?" report could only
    // ever surface Standard's Blocked before this.
    for (const c of BASELINE_CYCLES) {
      const stalled = c.statuses.filter((s) => qualificationOf(s.id, c.statuses) === "stalled");
      expect(stalled).toHaveLength(1);
    }
  });

  it("puts the stalled stage last before Done", () => {
    // Among the stages it would read as one of them — a step work passes
    // through on the way, rather than a state it sits in.
    for (const c of BASELINE_CYCLES) {
      expect(c.statuses[c.statuses.length - 2].qualifies).toBe("stalled");
    }
  });

  it("starts every template with a planned stage", () => {
    // `initialStatusOf` stamps a new task with the first stage, so if that were
    // "ongoing" every task would be created already in progress.
    for (const c of BASELINE_CYCLES) {
      expect(c.statuses[0].qualifies).toBe("planned");
    }
  });

  it("uses ids unique within each cycle, and cycle ids unique across them", () => {
    expect(new Set(BASELINE_CYCLES.map((c) => c.id)).size).toBe(BASELINE_CYCLES.length);
    for (const c of BASELINE_CYCLES) {
      expect(new Set(c.statuses.map((s) => s.id)).size).toBe(c.statuses.length);
    }
  });

  it("keeps every template to six stages", () => {
    // Four working stages, one stalled, Done. Wider than this and a grouped
    // board stops fitting a laptop.
    for (const c of BASELINE_CYCLES.filter((c) => c.id !== "cy-standard")) {
      expect(c.statuses).toHaveLength(6);
    }
  });
});

describe("Standard", () => {
  it("is first", () => {
    // CY12a, load-bearing: CY4 pre-selects the organisation's first cycle.
    // Reordering this list silently changes what every new Beat starts with.
    expect(BASELINE_CYCLES[0].id).toBe("cy-standard");
  });

  it("is exactly today's statuses", () => {
    // What makes CY11 an identity: a Beat that never customised its statuses
    // resolves to this cycle with nothing written. If they drift, an existing
    // Beat and a new one disagree about what "Standard" means.
    expect(BASELINE_CYCLES[0].statuses).toEqual(DEFAULT_STATUSES);
  });

  it("shipped in version 1, and everything else after it", () => {
    expect(BASELINE_CYCLES[0].since).toBe(1);
    expect(BASELINE_CYCLES.slice(1).every((c) => c.since === 2)).toBe(true);
    expect(CURRENT_SEED_VERSION).toBe(2);
  });
});

describe("choosing what to seed", () => {
  it("offers everything to an org that has seen nothing", () => {
    expect(cyclesToSeed(0, new Set()).map((c) => c.id)).toEqual(BASELINE_CYCLES.map((c) => c.id));
  });

  it("offers only the newer batch to an org holding the first", () => {
    expect(cyclesToSeed(1, new Set(["cy-standard"])).map((c) => c.id))
      .toEqual(BASELINE_CYCLES.filter((c) => c.since === 2).map((c) => c.id));
  });

  it("offers nothing to an org that is current", () => {
    expect(cyclesToSeed(CURRENT_SEED_VERSION, new Set())).toEqual([]);
  });

  it("skips a template the org still holds", () => {
    // Belt and braces against a double-add if a marker were ever lost.
    const have = new Set(["cy-pd-digital"]);
    expect(cyclesToSeed(1, have).some((c) => c.id === "cy-pd-digital")).toBe(false);
  });

  it("strips the seeding bookkeeping from what is stored", () => {
    // `since` answers "have we offered this", which means nothing inside a
    // Beat. Writing it would put an unknown field on every copied cycle.
    for (const c of asCycles(BASELINE_CYCLES)) {
      expect("since" in c).toBe(false);
    }
  });
});
