import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Resource } from "@/types";

/**
 * The assign-resource button has to LOOK open when the picker under it is open.
 *
 * It shipped with the chevron carrying that distinction alone, and a chevron
 * could not carry it: the button already looks emphatic when closed — orange
 * border, accent fill — so opening it changed a 15px arrow and nothing else.
 * The picker deliberately stays open after a pick so several people can be
 * added in a row, which makes "open" a mode you sit in rather than a menu that
 * flashes past.
 *
 * Style and ARIA are asserted together because they are the same bug in two
 * layers: with only a chevron, a screen reader was told nothing at all.
 */

vi.mock("@/stores/pulseStore", () => ({
  usePulseStore: (sel: (s: { resources: Resource[]; members: never[] }) => unknown) =>
    sel({ resources: [], members: [] }),
}));

const { AssignResourcePicker } = await import("./DetailsTab");

const resource = (id: string, name: string): Resource =>
  ({ id, name, initials: name.slice(0, 2).toUpperCase(), capacity: 100 }) as Resource;

const RESOURCES = [resource("r1", "Ada"), resource("r2", "Grace")];

function setup(assigned: string[] = []) {
  const onAssign = vi.fn();
  render(<AssignResourcePicker resources={RESOURCES} assignedIds={assigned} onAssign={onAssign} />);
  // The toggle is the only button when the picker is shut.
  const button = screen.getAllByRole("button")[0];
  return { button, onAssign };
}

/** The panel's filled "on" treatment, as `PLAN_ON` defines it. */
const ORANGE = "rgb(238, 114, 64)";

describe("the assign button reflects whether the picker is open", () => {
  it("starts closed", () => {
    const { button } = setup();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button.style.background).not.toBe(ORANGE);
  });

  it("fills when opened", () => {
    const { button } = setup();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button.style.background).toBe(ORANGE);
  });

  it("returns to its resting look when closed again", () => {
    const { button } = setup();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button.style.background).not.toBe(ORANGE);
  });

  // The two states must be distinguishable by something other than the
  // chevron, which is what the report was about.
  it("looks different open vs closed", () => {
    const { button } = setup();
    const closed = button.getAttribute("style") ?? "";
    fireEvent.click(button);
    expect(button.getAttribute("style") ?? "").not.toBe(closed);
  });
});

describe("the button announces the region it controls", () => {
  it("points at the picker, and the picker exists when open", () => {
    const { button } = setup();
    const id = button.getAttribute("aria-controls");
    expect(id).toBeTruthy();
    expect(document.getElementById(id as string)).toBeNull();
    fireEvent.click(button);
    expect(document.getElementById(id as string)).not.toBeNull();
  });
});

describe("it still does its job", () => {
  it("lists the unassigned resources and assigns one", () => {
    const { button, onAssign } = setup();
    fireEvent.click(button);
    fireEvent.click(screen.getByText("Ada"));
    expect(onAssign).toHaveBeenCalledWith("r1");
  });

  // Staying open after a pick is the reason the open state needs to be
  // visible in the first place.
  it("stays open after assigning, so several can be added in a row", () => {
    const { button } = setup();
    fireEvent.click(button);
    fireEvent.click(screen.getByText("Ada"));
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("omits people already assigned", () => {
    const { button } = setup(["r1"]);
    fireEvent.click(button);
    expect(screen.queryByText("Ada")).toBeNull();
    expect(screen.getByText("Grace")).toBeTruthy();
  });
});
