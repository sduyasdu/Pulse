import { render, screen, fireEvent, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Feature, Resource } from "@/types";

/**
 * The Capacity tab is gone and its content lives here now, so what needs
 * pinning is that nothing was lost in the move — and that the row stays
 * scannable when it is.
 *
 * The two tabs had drifted into showing the same thing: identical load bars,
 * identical search axes, and a `type · limit N%` line in Team that restated
 * what Capacity let you edit. Merging removed the duplication; these assert the
 * editing half survived it.
 */

const person = (id: string, name: string, over: Partial<Resource> = {}): Resource =>
  ({ id, name, initials: name.slice(0, 2).toUpperCase(), capacity: 100, ...over }) as Resource;

const state = {
  resources: [person("r1", "Ada", { type: "Backend" }), person("r2", "Grace")],
  features: [] as Feature[],
  members: [],
  rates: [],
  pulse: { id: "p1", workspaceId: "w1", resourceTypes: ["Backend", "Design"] },
  addResource: vi.fn(),
  removeResource: vi.fn(),
  duplicateResource: vi.fn(),
  patchResource: vi.fn(),
  setResourceTypes: vi.fn(),
  setRate: vi.fn(),
};

vi.mock("@/stores/pulseStore", () => ({
  usePulseStore: (sel: (s: typeof state) => unknown) => sel(state),
}));
vi.mock("@/stores/authStore", () => ({
  useAuthStore: (sel: (s: { firebaseUser: { uid: string; email: string } }) => unknown) =>
    sel({ firebaseUser: { uid: "u1", email: "me@example.com" } }),
}));
vi.mock("@/stores/confirmStore", () => ({ confirmAt: () => Promise.resolve(false) }));
vi.mock("@/lib/firebase", () => ({ db: {}, auth: {}, googleProvider: {}, functions: {} }));

const { TeamTab } = await import("./TeamTab");

// The store mock is shared, so its call log carries between tests — and a
// "was not called yet" assertion would then be answered by an earlier test.
beforeEach(() => vi.clearAllMocks());

const setup = (canEdit = true) =>
  render(<TeamTab canEdit={canEdit} filterResource={null} setFilterResource={() => {}} />);

const byLabel = (label: string) => screen.getByLabelText(label);

describe("the row stays scannable", () => {
  // The whole reason the merge needed disclosure: a 320px row cannot hold a
  // badge, a name, three actions, a link select, three bars AND a slider, a
  // select and a rate field without becoming a form.
  it("hides the editors until a row is opened", () => {
    setup();
    expect(screen.queryByText("LIMIT %")).toBeNull();
  });

  it("reveals them for the row that was opened", () => {
    setup();
    fireEvent.click(screen.getAllByLabelText("Type, limit and rate")[0]);
    expect(screen.getByText("LIMIT %")).toBeTruthy();
    expect(screen.getByText("TYPE")).toBeTruthy();
  });

  // One at a time: several open at once is the form this was avoiding.
  it("closes the previous row when another is opened", () => {
    setup();
    const toggles = screen.getAllByLabelText("Type, limit and rate");
    fireEvent.click(toggles[0]);
    fireEvent.click(toggles[1]);
    expect(screen.getAllByText("LIMIT %")).toHaveLength(1);
  });

  it("closes on a second click of the same row", () => {
    setup();
    const toggle = screen.getAllByLabelText("Type, limit and rate")[0];
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.queryByText("LIMIT %")).toBeNull();
  });

  it("says whether it is open", () => {
    setup();
    const toggle = screen.getAllByLabelText("Type, limit and rate")[0];
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});

describe("what the Capacity tab used to own", () => {
  it("still edits the limit", () => {
    setup();
    fireEvent.click(screen.getAllByLabelText("Type, limit and rate")[0]);
    const slider = document.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "40" } });
    expect(state.patchResource).toHaveBeenCalledWith("r1", { capacity: 40 });
  });

  it("still edits the type, from the Pulse's own list", () => {
    setup();
    fireEvent.click(screen.getAllByLabelText("Type, limit and rate")[0]);
    const select = document.querySelector("select") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toContain("Design");
    fireEvent.change(select, { target: { value: "Design" } });
    expect(state.patchResource).toHaveBeenCalledWith("r1", { type: "Design" });
  });
});

describe("resource types are Pulse configuration, not a person's", () => {
  // They took a permanent slot in a 320px panel to say something about the
  // Pulse rather than about anyone in it.
  it("stays shut until its icon button is used", () => {
    setup();
    expect(screen.queryByText("RESOURCE TYPES")).toBeNull();
    fireEvent.click(byLabel("Manage resource types"));
    expect(screen.getByText("RESOURCE TYPES")).toBeTruthy();
  });

  it("lists the Pulse's types", () => {
    setup();
    fireEvent.click(byLabel("Manage resource types"));
    expect(screen.getByText("Backend")).toBeTruthy();
  });

  it("says whether it is open", () => {
    setup();
    const b = byLabel("Manage resource types");
    expect(b).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(b);
    expect(b).toHaveAttribute("aria-expanded", "true");
  });
});

describe("the name is edited where it is read", () => {
  // It used to be a second field inside the expanded settings: the name
  // appeared twice in one row, and renaming meant opening a panel to change
  // something already on screen.
  it("is editable from the card, without opening anything", () => {
    vi.useFakeTimers();
    try {
      setup();
      const field = screen.getByDisplayValue("Ada");
      fireEvent.change(field, { target: { value: "Ada L" } });
      // Debounced by 500ms — a rename is a document write, not a keystroke.
      // Asserting straight after the change would pass against a field that
      // commits nothing at all.
      expect(state.patchResource).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(600));
      expect(state.patchResource).toHaveBeenCalledWith("r1", { name: "Ada L" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not appear a second time in the settings", () => {
    setup();
    fireEvent.click(screen.getAllByLabelText("Type, limit and rate")[0]);
    expect(screen.getAllByDisplayValue("Ada")).toHaveLength(1);
  });

  // The row is both a filter toggle and a drag source. Neither should fire
  // because someone put a caret in a name.
  it("does not toggle the row filter when clicked", () => {
    const setFilter = vi.fn();
    render(<TeamTab canEdit filterResource={null} setFilterResource={setFilter} />);
    fireEvent.click(screen.getByDisplayValue("Ada"));
    expect(setFilter).not.toHaveBeenCalled();
  });

  it("is plain text for a viewer, with no edit affordance", () => {
    setup(false);
    const field = screen.getByDisplayValue("Ada") as HTMLInputElement;
    expect(field.disabled).toBe(true);
    expect(field.className).not.toContain("hover:");
  });
});

describe("an open row is visibly the one being worked on", () => {
  // jsdom reports computed colours as rgb(), not as the hex the source writes.
  const ORANGE = "rgb(238, 114, 64)"; // #EE7240
  const RESTING = "rgb(226, 223, 217)"; // #E2DFD9
  const borderOf = (name: string) => {
    const field = screen.getByDisplayValue(name);
    // input → name/badge wrapper → header row → the card
    return (field.closest("[draggable]") as HTMLElement).style.border;
  };

  it("is a plain border at rest", () => {
    setup();
    expect(borderOf("Ada")).toContain(RESTING);
  });

  it("turns orange, and heavier, while its settings are open", () => {
    setup();
    fireEvent.click(screen.getAllByLabelText("Type, limit and rate")[0]);
    expect(borderOf("Ada")).toContain(ORANGE);
    expect(borderOf("Ada")).toContain("2px");
  });

  // Filtering is also orange, so weight is what separates them — and both can
  // be true at once.
  it("outweighs the filtering highlight", () => {
    render(<TeamTab canEdit filterResource="r1" setFilterResource={() => {}} />);
    expect(borderOf("Ada")).toBe(`1px solid ${ORANGE}`);
    fireEvent.click(screen.getAllByLabelText("Type, limit and rate")[0]);
    expect(borderOf("Ada")).toBe(`2px solid ${ORANGE}`);
  });

  it("leaves the other rows alone", () => {
    setup();
    fireEvent.click(screen.getAllByLabelText("Type, limit and rate")[0]);
    expect(borderOf("Grace")).toContain(RESTING);
  });
});

describe("a viewer gets no editors", () => {
  it("offers neither the add buttons nor the type manager", () => {
    setup(false);
    expect(screen.queryByLabelText("Manage resource types")).toBeNull();
    expect(screen.queryByLabelText("Add a new person to this Pulse only")).toBeNull();
  });
});
