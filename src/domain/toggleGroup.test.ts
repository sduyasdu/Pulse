import { describe, expect, it } from "vitest";
import { toggleGroup } from "./toggleGroup";

describe("toggling a whole group of ids", () => {
  it("selects everything under it", () => {
    expect([...toggleGroup(new Set(), ["a", "b"])].sort()).toEqual(["a", "b"]);
  });

  it("clears them when they are all already selected", () => {
    expect([...toggleGroup(new Set(["a", "b"]), ["a", "b"])]).toEqual([]);
  });

  it("completes a partial selection rather than clearing it", () => {
    // Half-selected means "I want more of this", not "undo". Clearing here
    // would throw away a choice the user just made one click ago.
    expect([...toggleGroup(new Set(["a"]), ["a", "b"])].sort()).toEqual(["a", "b"]);
  });

  it("leaves other groups alone", () => {
    expect([...toggleGroup(new Set(["x", "a", "b"]), ["a", "b"])]).toEqual(["x"]);
  });
});

describe("an empty group", () => {
  it("changes nothing rather than clearing everything", () => {
    // "Collapse all" on a board showing no sections. Pinned because it is a
    // reachable state — every cycle filtered out — not because the code has a
    // branch for it: the loop simply iterates nothing.
    expect([...toggleGroup(new Set(["x"]), [])]).toEqual(["x"]);
  });
});
