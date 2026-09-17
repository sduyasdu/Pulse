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
const state = {
  pulse: null as unknown,
  features: [] as unknown[],
  epics: [] as unknown[],
  setCycles: (...a: unknown[]) => setCycles(...a),
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
  it("is refused, and says which tasks hold it", async () => {
    state.pulse = { id: "p1", cycles: [
      { id: "std", name: "Standard", statuses: [{ id: "p", label: "P", color: "#000" }, { id: "done", label: "Done", color: "#000" }] },
      { id: "rev", name: "Review", statuses: [{ id: "r", label: "R", color: "#000" }, { id: "done", label: "Done", color: "#000" }] },
    ], defaultCycleId: "std" };
    state.features = [task("t1", "rev"), task("t2", "rev")];
    render(<CycleEditorDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText(/2 tasks use it/)).toBeTruthy();
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
    expect(await screen.findByText(/1 of those are done/)).toBeTruthy();
  });

  it("refuses the Beat's own default even when nothing uses it", async () => {
    state.pulse = { id: "p1", cycles: [
      { id: "std", name: "Standard", statuses: [{ id: "p", label: "P", color: "#000" }, { id: "done", label: "Done", color: "#000" }] },
    ], defaultCycleId: "std" };
    render(<CycleEditorDialog onClose={() => {}} />);
    expect(await screen.findByText(/this Beat's default/)).toBeTruthy();
  });
});
