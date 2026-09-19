import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Collapsing a cycle on the board.
 *
 * The bug worth a test is not "does it hide" — a screenshot answers that. It is
 * that a collapsed section must be **gone**, not merely invisible: its columns
 * carry drop targets, and a hidden section that still accepts a dragged card is
 * a card dropped somewhere nobody can see.
 */
const state = {
  pulse: null as unknown,
  features: [] as unknown[],
  epics: [] as unknown[],
  resources: [] as unknown[],
  setFeatureStatus: vi.fn(),
  moveFeatureToEpic: vi.fn(),
  addFeature: vi.fn(),
  addEpic: vi.fn(),
  patchEpic: vi.fn(),
  duplicateFeature: vi.fn(),
  removeFeature: vi.fn(),
  setCycles: vi.fn(),
};
vi.mock("@/stores/pulseStore", async () => {
  const actual = await vi.importActual<typeof import("@/stores/pulseStore")>("@/stores/pulseStore");
  return { ...actual, usePulseStore: (sel: (s: unknown) => unknown) => sel(state) };
});
vi.mock("@/lib/firebase", () => ({ db: {}, auth: {}, googleProvider: {}, functions: {} }));

const { KanbanView } = await import("./KanbanView");

const cycles = [
  { id: "std", name: "Standard", statuses: [{ id: "s0", label: "Planned", color: "#000" }, { id: "done", label: "Done", color: "#000" }] },
  { id: "rev", name: "Review", statuses: [{ id: "r0", label: "Triage", color: "#000" }, { id: "done", label: "Done", color: "#000" }] },
];
const task = (id: string, status: string, cycleId: string) =>
  ({ id, title: id, status, cycleId, x: 0, y: 0, duration: 1, work: 1, resources: [], epicId: "e1" });

beforeEach(() => {
  vi.clearAllMocks();
  state.pulse = { id: "p1", cycles, defaultCycleId: "std" };
  state.epics = [{ id: "e1", name: "Platform", color: "#000", y0: 0, y1: 10 }];
  state.features = [task("a", "s0", "std"), task("b", "r0", "rev")];
  state.resources = [];
});

const view = (collapsed: Set<string>, setCollapsed = vi.fn(), cycleFilter = new Set<string>()) => {
  render(
    <KanbanView
      selectedId={null} onSelect={vi.fn()} canEdit canEditFeature={() => true}
      featureQuery="" featureStatusFilter={new Set()} epicFilter={new Set()}
      cycleFilter={cycleFilter} setCycleFilter={vi.fn()}
      collapsedCycles={collapsed} setCollapsedCycles={setCollapsed}
      filterResource={null} myResourceIds={null}
    />,
  );
  return setCollapsed;
};

/**
 * The section header, not the CY15 filter chip above it — both carry the cycle's
 * name, and the chip is a different control with different behaviour. The
 * header is the one that reports expansion.
 */
const header = (name: string) =>
  [...document.querySelectorAll("button[aria-expanded]")]
    .find((b) => b.textContent?.includes(name)) as HTMLElement;

describe("a collapsed cycle", () => {
  it("keeps its name and task count", () => {
    // What the user asked to still see.
    view(new Set(["std"]));
    expect(header("Standard")).toBeTruthy();
    expect(header("Standard").textContent).toMatch(/1 task/);
  });

  it("removes its columns from the document, not just from view", () => {
    // `display: none` would pass a screenshot and still accept a drop.
    view(new Set(["std"]));
    expect(screen.queryByDisplayValue("Planned")).toBeNull();
    // ...while the cycle that is not collapsed still has its own.
    expect(screen.getByDisplayValue("Triage")).toBeTruthy();
  });

  it("leaves both cycles' columns up when nothing is collapsed", () => {
    view(new Set());
    expect(screen.getByDisplayValue("Planned")).toBeTruthy();
    expect(screen.getByDisplayValue("Triage")).toBeTruthy();
  });

  it("toggles from the header, which is the whole row", () => {
    const set = view(new Set());
    fireEvent.click(header("Standard"));
    expect([...set.mock.calls[0][0]]).toEqual(["std"]);
  });

  it("leaves the other cycle alone when one header is clicked", () => {
    const set = view(new Set(["rev"]));
    fireEvent.click(header("Standard"));
    expect([...set.mock.calls[0][0]].sort()).toEqual(["rev", "std"]);
  });

  it("reports its state to assistive tech", () => {
    // The chevron is the only visual cue; without aria-expanded a screen reader
    // gets a button that says nothing about what it did.
    view(new Set(["std"]));
    expect(header("Standard").getAttribute("aria-expanded")).toBe("false");
    expect(header("Review").getAttribute("aria-expanded")).toBe("true");
  });
});

describe("the collapse-all control", () => {
  const bulk = () => screen.getByRole("button", { name: /Collapse all|Expand all/ });

  it("collapses every visible cycle", () => {
    const set = view(new Set());
    fireEvent.click(bulk());
    expect([...set.mock.calls[0][0]].sort()).toEqual(["rev", "std"]);
  });

  it("finishes the job from a partly collapsed board rather than undoing it", () => {
    // The case a naive toggle gets wrong. One section is already shut, so the
    // button reads "Collapse all" — and pressing it must shut the other, not
    // reopen the first.
    const set = view(new Set(["std"]));
    expect(bulk().textContent).toMatch(/Collapse all/);
    fireEvent.click(bulk());
    expect([...set.mock.calls[0][0]].sort()).toEqual(["rev", "std"]);
  });

  it("offers to expand once everything is collapsed", () => {
    const set = view(new Set(["std", "rev"]));
    expect(bulk().textContent).toMatch(/Expand all/);
    fireEvent.click(bulk());
    expect([...set.mock.calls[0][0]]).toEqual([]);
  });

  it("acts on the cycles the board is showing, not the ones it is hiding", () => {
    // With the CY15 chips filtered to Review, "collapse all" means the one
    // section on screen. Reaching for `board.sections` instead would shut
    // Standard too — a cycle the user cannot see, cannot see collapse, and
    // would find shut the next time they cleared the filter.
    const set = view(new Set(), vi.fn(), new Set(["rev"]));
    fireEvent.click(bulk());
    expect([...set.mock.calls[0][0]]).toEqual(["rev"]);
  });

  it("does not appear on a single-cycle board", () => {
    // It lives in the cycles row, which only exists when the board is grouped —
    // and an ungrouped board has no section headers to collapse.
    state.features = [task("a", "s0", "std")];
    view(new Set());
    expect(screen.queryByRole("button", { name: /Collapse all|Expand all/ })).toBeNull();
  });
});
