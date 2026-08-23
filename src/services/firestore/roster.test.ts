import { describe, it, expect } from "vitest";
import { initialsOf } from "./roster";

/** Initials are derived, not typed, so they are the one place a roster entry can
 * silently disagree with the same person's Pulse copy. */
describe("initialsOf", () => {
  it("takes first and last for a full name", () => {
    expect(initialsOf("Ana Torres")).toBe("AT");
    expect(initialsOf("Ana María Torres")).toBe("AT");
  });

  it("takes two letters from a single name", () => {
    expect(initialsOf("Ana")).toBe("AN");
  });

  it("tolerates the input a form actually produces", () => {
    expect(initialsOf("  ana   torres  ")).toBe("AT");
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
  });

  it("uppercases, so a lowercase entry does not look like a different person", () => {
    expect(initialsOf("ana torres")).toBe("AT");
  });
});
