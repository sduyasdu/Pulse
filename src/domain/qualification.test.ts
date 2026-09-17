import { describe, expect, it } from "vitest";
import { qualificationOf, DEFAULT_STATUSES, QUALIFICATION_ORDER, STATUS_QUALIFICATIONS } from "./constants";
import type { StatusDef } from "@/types";

/**
 * What a status counts as, across cycles that name their stages differently.
 *
 * Without this, anything summarising a Beat has to guess whether "Triage" is
 * work not started or work underway — and the roadmap-report skill's answer to
 * that today is to stop and ask the user, every time, which with several cycles
 * is every report.
 */
const cycle = (...s: StatusDef[]): StatusDef[] => [...s, { id: "done", label: "Done", color: "#12A594" }];

describe("the terminal status", () => {
  it("is always done, whatever the cycle says", () => {
    // Not overridable: CY5 makes `done` the one status every cycle shares, and
    // the lock, finishedAt and every completion count hang off it.
    const odd = cycle({ id: "a", label: "A", color: "#000", qualifies: "ongoing" });
    expect(qualificationOf("done", odd)).toBe("done");
  });

  it("is done even if someone qualifies it otherwise", () => {
    const sneaky: StatusDef[] = [{ id: "done", label: "Shipped", color: "#000", qualifies: "ongoing" }];
    expect(qualificationOf("done", sneaky)).toBe("done");
  });
});

describe("an explicit qualification", () => {
  it("is used as given", () => {
    const c = cycle(
      { id: "triage", label: "Triage", color: "#000", qualifies: "planned" },
      { id: "waiting", label: "Waiting", color: "#000", qualifies: "stalled" },
      { id: "exec", label: "Executing", color: "#000", qualifies: "ongoing" },
    );
    expect(qualificationOf("triage", c)).toBe("planned");
    expect(qualificationOf("waiting", c)).toBe("stalled");
    expect(qualificationOf("exec", c)).toBe("ongoing");
  });

  it("wins over what position would infer", () => {
    // Second stage, so position says "ongoing" — the author says otherwise.
    const c = cycle(
      { id: "a", label: "A", color: "#000" },
      { id: "waiting", label: "Waiting", color: "#000", qualifies: "stalled" },
    );
    expect(qualificationOf("waiting", c)).toBe("stalled");
  });
});

describe("when a stage does not say", () => {
  const bare = cycle({ id: "first", label: "First", color: "#000" }, { id: "second", label: "Second", color: "#000" });

  it("treats the first stage as planned", () => {
    expect(qualificationOf("first", bare)).toBe("planned");
  });

  it("treats a middle stage as ongoing", () => {
    expect(qualificationOf("second", bare)).toBe("ongoing");
  });

  it("cannot infer stalled, which is why the editor asks", () => {
    // Nothing about position distinguishes "Waiting" from "Executing". A cycle
    // that wants a stalled stage has to declare it.
    expect(qualificationOf("second", bare)).not.toBe("stalled");
  });
});

describe("a Beat that predates cycles", () => {
  // Its statuses have no `qualifies` — that field did not exist. Migration
  // writes nothing (CY11), so the resolver has to get these right from the id
  // alone. Without it, "Blocked" resolves to ongoing and every existing Beat
  // silently reports stalled work as underway. This is the case the prototype
  // caught: the board rendered "Blocked" as ONGOING.
  const legacy: StatusDef[] = [
    { id: "planned", label: "Planned", color: "#64748B" },
    { id: "in-progress", label: "In progress", color: "#F5A524" },
    { id: "blocked", label: "Blocked", color: "#E5484D" },
    { id: "done", label: "Done", color: "#12A594" },
  ];

  it("keeps blocked meaning stalled", () => {
    expect(qualificationOf("blocked", legacy)).toBe("stalled");
  });

  it("keeps the other built-ins meaning what they always did", () => {
    expect(qualificationOf("planned", legacy)).toBe("planned");
    expect(qualificationOf("in-progress", legacy)).toBe("ongoing");
    expect(qualificationOf("done", legacy)).toBe("done");
  });

  it("still lets an explicit qualification override a built-in id", () => {
    // A cycle that reuses the id `blocked` for something that is not stalled
    // must be able to say so.
    const odd: StatusDef[] = [
      { id: "a", label: "A", color: "#000" },
      { id: "blocked", label: "Held for review", color: "#000", qualifies: "ongoing" },
      { id: "done", label: "Done", color: "#000" },
    ];
    expect(qualificationOf("blocked", odd)).toBe("ongoing");
  });
});

describe("the built-in cycle", () => {
  it("qualifies every stage, so nothing is inferred", () => {
    expect(qualificationOf("planned", DEFAULT_STATUSES)).toBe("planned");
    expect(qualificationOf("in-progress", DEFAULT_STATUSES)).toBe("ongoing");
    expect(qualificationOf("blocked", DEFAULT_STATUSES)).toBe("stalled");
    expect(qualificationOf("done", DEFAULT_STATUSES)).toBe("done");
  });
});

describe("an orphaned status", () => {
  it("counts as ongoing rather than vanishing", () => {
    // CY7 keeps an orphan visible; a summary must place it somewhere, and it is
    // certainly not done.
    expect(qualificationOf("gone", cycle({ id: "a", label: "A", color: "#000" }))).toBe("ongoing");
  });
});

describe("the qualification set", () => {
  it("is the three the product owner named, plus done", () => {
    expect(STATUS_QUALIFICATIONS.map((q) => q.id)).toEqual(["planned", "stalled", "ongoing"]);
    expect(Object.keys(QUALIFICATION_ORDER).sort()).toEqual(["done", "ongoing", "planned", "stalled"]);
  });

  it("orders them for reporting, with done last", () => {
    expect(QUALIFICATION_ORDER.done).toBeGreaterThan(QUALIFICATION_ORDER.ongoing);
    expect(STATUS_QUALIFICATIONS.map((q) => q.order)).toEqual([1, 2, 3]);
  });
});
