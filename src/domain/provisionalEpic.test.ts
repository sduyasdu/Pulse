import { describe, expect, it } from "vitest";
import { isProvisionalEpic } from "./layout";

const DEFAULT = "New epic";
const provisional = (name: string | null | undefined, count: number) => isProvisionalEpic({ name, count }, DEFAULT);

describe("an epic that is not set up yet", () => {
  // Exactly what the toolbar's Add epic produces.
  it("is provisional straight after being created", () => {
    expect(provisional(DEFAULT, 0)).toBe(true);
  });

  it("stops being provisional once it is named AND holds work", () => {
    expect(provisional("Billing", 1)).toBe(false);
  });

  it("stays provisional when named but still empty", () => {
    expect(provisional("Billing", 0)).toBe(true);
  });

  it("stays provisional when it holds work but is still unnamed", () => {
    expect(provisional(DEFAULT, 3)).toBe(true);
  });
});

describe("what counts as named", () => {
  // The default is a placeholder the product wrote, not a name anyone chose.
  // Counting it as named would end the emphasis at the moment the epic is least
  // finished — which is the whole case this exists for.
  it("does not count the default name", () => {
    expect(provisional(DEFAULT, 5)).toBe(true);
  });

  it("does not count blank or whitespace", () => {
    expect(provisional("", 5)).toBe(true);
    expect(provisional("   ", 5)).toBe(true);
  });

  it("does not count the default with stray whitespace round it", () => {
    expect(provisional("  New epic  ", 5)).toBe(true);
  });

  it("counts a name that merely contains the default", () => {
    expect(provisional("New epic ideas", 5)).toBe(false);
  });

  it("tolerates a missing name", () => {
    expect(provisional(undefined, 5)).toBe(true);
    expect(provisional(null, 5)).toBe(true);
  });
});

describe("it is a property of the epic, not of the session", () => {
  // A session-scoped "recently added" flag would clear on reload and drop a
  // still-empty, still-unnamed epic back behind everything — which is where it
  // is unreachable, because task boxes cover its header.
  it("gives the same answer for an epic regardless of when it was made", () => {
    const stale = { name: DEFAULT, count: 0 };
    expect(isProvisionalEpic(stale, DEFAULT)).toBe(true);
    expect(isProvisionalEpic(stale, DEFAULT)).toBe(true);
  });
});
