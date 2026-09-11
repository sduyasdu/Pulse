import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BeatsLockup, BeatsMark } from "./Logo";

/**
 * The product is "Beats"; one roadmap inside it is "a Beat". Nothing in the
 * type system can tell those apart — both are valid `BrandWord`s — so the rule
 * that decides which surface gets which lives here.
 */
describe("the lockup says which thing it is standing for", () => {
  it("is the product name unless told otherwise", () => {
    render(<BeatsLockup />);
    expect(screen.getByText("Beats")).toBeTruthy();
  });

  it("says the singular when it is inside one Beat", () => {
    render(<BeatsLockup word="Beat" />);
    expect(screen.getByText("Beat")).toBeTruthy();
    expect(screen.queryByText("Beats")).toBeNull();
  });

  it("labels the bare mark with the product, never one item", () => {
    render(<BeatsMark />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("Beats");
  });
});
