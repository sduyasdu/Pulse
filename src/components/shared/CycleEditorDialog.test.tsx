import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cycle editor.
 *
 * The two properties worth pinning are the ones a user would only discover by
 * losing work: a Beat that has never had cycles must open showing exactly what
 * it renders today (CY11), and a cycle that is in use must refuse to be deleted
 * with a reason rather than a shrug (CY17).
 */
const setCycles = vi.fn();
const setFeatureStatus = vi.fn();
const state = {
  pulse: null as unknown,
  features: [] as unknown[],
  epics: [] as unknown[],
  setCycles: (...a: unknown[]) => setCycles(...a),
  setFeatureStatus: (...a: unknown[]) => setFeatureStatus(...a),
};
vi.mock("@/stores/pulseStore", () => ({
  usePulseStore: (sel: (s: unknown) => unknown) => sel(state),
}));
vi.mock("@/lib/firebase", () => ({ db: {}, auth: {}, googleProvider: {}, functions: {} }));

const { CycleEditorDialog } = await import("./CycleEditorDialog");

const task = (id: string, cycleId: string, status = "planned") => ({ id, title: id, status, cycleId });

beforeEach(() => {
  vi.clearAllMocks();
  setCycles.mockResolvedValue(undefined);
  setFeatureStatus.mockResolvedValue(undefined);
  state.pulse = { id: "p1" };
  state.features = [];
  state.epics = [];
});

describe("a Beat that has never had cycles", () => {
  it("opens showing its current statuses as one cycle", () => {
    // CY11: computed, not migrated. Opening the dialog must not look like a
    // reset to someone who customised their statuses.
    state.pulse = { id: "p1", statuses: [{ id: "a", label: "Backlog", color: "#000" }, { id: "done", label: "Done", color: "#000" }] };
    render(<CycleEditorDialog onClose={() => {}} />);
    expect(screen.getByDisplayValue("Backlog")).toBeTruthy();
  });

  it("writes nothing on cancel", () => {
    render(<CycleEditorDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(setCycles).not.toHaveBeenCalled();
  });
});

describe("Done", () => {
  it("is shown but not editable", () => {
    // CY5: it is the one stage every cycle shares, and the lock, finishedAt and
    // every completion count hang off it.
    render(<CycleEditorDialog onClose={() => {}} />);
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.queryByDisplayValue("Done")).toBeNull();
  });

  it("is last in what gets saved, whatever the editing did", async () => {
    render(<CycleEditorDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));
    await waitFor(() => expect(setCycles).toHaveBeenCalled());
    const [cycles] = setCycles.mock.calls[0] as [{ statuses: { id: string }[] }[]];
    for (const c of cycles) expect(c.statuses.at(-1)!.id).toBe("done");
  });
});

describe("deleting a cycle in use", () => {
  /**
   * The reasons are no longer on the card — CY17 now shows a lock, and the
   * reasons live in its accessible name. Queried that way rather than dropped,
   * because the property under test has not changed: the refusal still has to
   * say which tasks hold the cycle, and an icon that says nothing to a screen
   * reader would be the refusal with no reason at all.
   */
  const lockText = async () => (await screen.findByRole("img")).getAttribute("aria-label") ?? "";

  it("is refused, and says which tasks hold it", async () => {
    state.pulse = { id: "p1", cycles: [
      { id: "std", name: "Standard", statuses: [{ id: "p", label: "P", color: "#000" }, { id: "done", label: "Done", color: "#000" }] },
      { id: "rev", name: "Review", statuses: [{ id: "r", label: "R", color: "#000" }, { id: "done", label: "Done", color: "#000" }] },
    ], defaultCycleId: "std" };
    state.features = [task("t1", "rev"), task("t2", "rev")];
    render(<CycleEditorDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await lockText()).toMatch(/2 tasks use it/);
    expect(screen.queryByRole("button", { name: /Delete this cycle/i })).toBeNull();
  });

  it("names done tasks separately, since their cycle cannot be changed", async () => {
    // CY2b. Telling someone to reassign these would send them at a control the
    // app refuses.
    state.pulse = { id: "p1", cycles: [
      { id: "std", name: "Standard", statuses: [{ id: "p", label: "P", color: "#000" }, { id: "done", label: "Done", color: "#000" }] },
      { id: "rev", name: "Review", statuses: [{ id: "r", label: "R", color: "#000" }, { id: "done", label: "Done", color: "#000" }] },
    ], defaultCycleId: "std" };
    state.features = [task("t1", "rev", "done")];
    render(<CycleEditorDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await lockText()).toMatch(/1 of those are done/);
  });

  it("shows a mark, and no text on the card", async () => {
    // The card carries a lock and nothing else. Without this, restoring the
    // old panel would leave every other test in this block green — they read
    // the accessible name, which the panel also had.
    state.pulse = { id: "p1", cycles: [
      { id: "std", name: "Standard", statuses: [{ id: "p", label: "P", color: "#000" }, { id: "done", label: "Done", color: "#000" }] },
      { id: "rev", name: "Review", statuses: [{ id: "r", label: "R", color: "#000" }, { id: "done", label: "Done", color: "#000" }] },
    ], defaultCycleId: "std" };
    state.features = [task("t1", "rev"), task("t2", "rev")];
    render(<CycleEditorDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));

    expect(await screen.findByRole("img")).toBeTruthy();
    // `getByText` matches rendered text content, not `aria-label` — so these
    // being absent is exactly the "no text on the card" the design asks for.
    expect(screen.queryByText(/2 tasks use it/)).toBeNull();
    expect(screen.queryByText(/This cycle is in use/)).toBeNull();
  });

  it("refuses the Beat's own default even when nothing uses it", async () => {
    state.pulse = { id: "p1", cycles: [
      { id: "std", name: "Standard", statuses: [{ id: "p", label: "P", color: "#000" }, { id: "done", label: "Done", color: "#000" }] },
    ], defaultCycleId: "std" };
    render(<CycleEditorDialog onClose={() => {}} />);
    expect(await lockText()).toMatch(/this Beat's default/);
  });
});

describe("deleting a stage tasks are sitting in (CY7)", () => {
  const twoStage = {
    id: "p1",
    defaultCycleId: "std",
    cycles: [{
      id: "std",
      name: "Standard",
      statuses: [
        { id: "planned", label: "Planned", color: "#64748B" },
        { id: "blocked", label: "Blocked", color: "#E5484D" },
        { id: "done", label: "Done", color: "#12A594" },
      ],
    }],
  };

  const removeBlocked = () => {
    // The × buttons are in stage order: Planned, then Blocked.
    const removes = screen.getAllByLabelText("Remove");
    fireEvent.click(removes[1]);
  };

  it("asks where the tasks go instead of deleting the stage", async () => {
    state.pulse = twoStage;
    state.features = [task("t1", "std", "blocked"), task("t2", "std", "blocked")];
    render(<CycleEditorDialog onClose={() => {}} />);
    removeBlocked();

    // Named and counted, not "are you sure?".
    expect(screen.getByText(/2 tasks are in/)).toBeTruthy();
    // And the stage is still there — nothing was removed on the strength of
    // the click alone.
    expect(screen.getByDisplayValue("Blocked")).toBeTruthy();
  });

  it("deletes a stage nothing is sitting in without asking", () => {
    state.pulse = twoStage;
    state.features = [task("t1", "std", "planned")];
    render(<CycleEditorDialog onClose={() => {}} />);
    removeBlocked();
    expect(screen.queryByText(/tasks are in/)).toBeNull();
    expect(screen.queryByDisplayValue("Blocked")).toBeNull();
  });

  it("counts only this cycle's tasks", () => {
    // Another cycle's "blocked" is a different stage that happens to share an
    // id, and must not hold this deletion up.
    state.pulse = {
      ...twoStage,
      cycles: [...twoStage.cycles, { id: "rev", name: "Review", statuses: [{ id: "blocked", label: "Blocked", color: "#000" }, { id: "done", label: "Done", color: "#000" }] }],
    };
    state.features = [task("t1", "rev", "blocked")];
    render(<CycleEditorDialog onClose={() => {}} />);
    removeBlocked();
    expect(screen.queryByText(/tasks are in/)).toBeNull();
  });

  it("moves the tasks before writing the cycles", async () => {
    state.pulse = twoStage;
    state.features = [task("t1", "std", "blocked")];
    render(<CycleEditorDialog onClose={() => {}} />);
    removeBlocked();

    fireEvent.change(screen.getByLabelText("Move them to…"), { target: { value: "planned" } });
    fireEvent.click(screen.getByText("Move and delete"));
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(setCycles).toHaveBeenCalled());
    expect(setFeatureStatus).toHaveBeenCalledWith("t1", "planned");
    // Order matters: the other way round leaves the task holding a stage that
    // no longer exists, permanently if the second write fails.
    expect(setFeatureStatus.mock.invocationCallOrder[0]).toBeLessThan(setCycles.mock.invocationCallOrder[0]);
  });

  it("writes nothing if the dialog is cancelled after a remap is chosen", () => {
    state.pulse = twoStage;
    state.features = [task("t1", "std", "blocked")];
    render(<CycleEditorDialog onClose={() => {}} />);
    removeBlocked();
    fireEvent.change(screen.getByLabelText("Move them to…"), { target: { value: "planned" } });
    fireEvent.click(screen.getByText("Move and delete"));
    // No Save. The remap is a decision recorded in the dialog, not a write.
    expect(setFeatureStatus).not.toHaveBeenCalled();
    expect(setCycles).not.toHaveBeenCalled();
  });
});

describe("editing a seeded name (Seed-Cycle-Translation SCT4)", () => {
  const seeded = {
    id: "p1",
    defaultCycleId: "std",
    cycles: [{
      id: "std",
      name: "Standard",
      i18nKey: "seed.cy-standard",
      statuses: [
        { id: "s0", label: "Planned", color: "#64748B", i18nKey: "seed.planned" },
        { id: "done", label: "Done", color: "#12A594", i18nKey: "seed.done" },
      ],
    }],
  };
  const savedCycle = () => (setCycles.mock.calls[0][0] as { statuses: { id: string; label: string; qualifies?: string; i18nKey?: string }[]; i18nKey?: string }[])[0];
  // By placeholder, not by value: the qualification <select> beside it also
  // displays "Planned", so `getByDisplayValue` finds two.
  const stageInput = () => screen.getByPlaceholderText("Stage name");

  it("drops the key from the stage that was typed over", async () => {
    // Their words are now what the stage is called, in every language. Keeping
    // the key would make this edit invisible to a colleague reading in French —
    // worse than not translating at all.
    state.pulse = seeded;
    render(<CycleEditorDialog onClose={() => {}} />);
    fireEvent.change(stageInput(), { target: { value: "Backlog" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(setCycles).toHaveBeenCalled());

    const stage = savedCycle().statuses.find((x) => x.id === "s0")!;
    expect(stage.i18nKey).toBeUndefined();
    expect(stage.label).toBe("Backlog");
  });

  it("leaves the other stages, and the cycle, translatable", async () => {
    // Per name, not per cycle: renaming one stage must not un-translate its
    // siblings, and must not un-translate the cycle it sits in.
    state.pulse = seeded;
    render(<CycleEditorDialog onClose={() => {}} />);
    fireEvent.change(stageInput(), { target: { value: "Backlog" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(setCycles).toHaveBeenCalled());

    expect(savedCycle().i18nKey).toBe("seed.cy-standard");
    expect(savedCycle().statuses.find((x) => x.id === "done")?.i18nKey).toBe("seed.done");
  });

  it("drops the cycle's key when the cycle is renamed", async () => {
    state.pulse = seeded;
    render(<CycleEditorDialog onClose={() => {}} />);
    fireEvent.change(screen.getByDisplayValue("Standard"), { target: { value: "Our way" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(setCycles).toHaveBeenCalled());

    expect(savedCycle().i18nKey).toBeUndefined();
    // ...and its stages are untouched.
    expect(savedCycle().statuses.find((x) => x.id === "s0")?.i18nKey).toBe("seed.planned");
  });

  it("keeps the key when only the qualification changes", async () => {
    // CY16's dropdown sits right beside the label. Changing how a stage is
    // counted in reports says nothing about what it is CALLED, so clearing the
    // key there would un-translate a stage for an unrelated reason — and the
    // person who did it would have no idea they had.
    state.pulse = seeded;
    render(<CycleEditorDialog onClose={() => {}} />);
    fireEvent.change(screen.getByTitle("How this stage is counted in reports that span cycles."), {
      target: { value: "stalled" },
    });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(setCycles).toHaveBeenCalled());

    const stage = savedCycle().statuses.find((x) => x.id === "s0")!;
    expect(stage.i18nKey).toBe("seed.planned");
    expect(stage.qualifies).toBe("stalled");
  });

  it("keeps every key when nothing is edited", async () => {
    // Opening the dialog and pressing Save must not un-translate a Beat. The
    // inputs show the reader's language while the state holds English, so a
    // render that wrote what it displayed would do exactly that.
    state.pulse = seeded;
    render(<CycleEditorDialog onClose={() => {}} />);
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(setCycles).toHaveBeenCalled());

    expect(savedCycle().i18nKey).toBe("seed.cy-standard");
    expect(savedCycle().statuses.map((x) => x.i18nKey)).toEqual(["seed.planned", "seed.done"]);
  });
});
