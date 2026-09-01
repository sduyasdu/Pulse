import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Epic, Feature } from "@/types";

/**
 * The one behaviour here that cannot be checked by reading the code: after
 * adding an epic, is the name field actually focused and its placeholder text
 * selected, so the first keystroke names it?
 *
 * jsdom has no layout engine, but it does implement focus and selection — which
 * is exactly the part at issue. Getting this wrong is silent: the tab opens, the
 * row is highlighted, and the caret is simply somewhere else.
 */

const DEFAULT_EPIC_NAME = "New epic";

let epics: Epic[] = [];
let features: Feature[] = [];

const epic = (id: string, over: Partial<Epic> = {}): Epic =>
  ({ id, name: DEFAULT_EPIC_NAME, color: "#8B5CF6", initialColor: "#8B5CF6", y0: 100, y1: 230, ...over }) as Epic;

vi.mock("@/stores/pulseStore", async () => {
  const actual = await vi.importActual<typeof import("@/stores/pulseStore")>("@/stores/pulseStore");
  const state = () => ({ epics, features, pulse: null, patchEpic: vi.fn(), removeEpic: vi.fn() });
  const usePulseStore = (sel: (s: ReturnType<typeof state>) => unknown) => sel(state());
  return { ...actual, usePulseStore };
});

vi.mock("@/stores/confirmStore", () => ({ confirmAt: () => Promise.resolve(false) }));

const { EpicsTab } = await import("./EpicsTab");

const renderTab = (selectedEpicId: string | null) =>
  render(
    <EpicsTab
      canEdit
      epicFilter={new Set()}
      setEpicFilter={() => {}}
      onAddEpic={() => {}}
      selectedEpicId={selectedEpicId}
      onSelectEpic={() => {}}
    />,
  );

beforeEach(() => {
  epics = [];
  features = [];
});

describe("naming an epic the moment it is created", () => {
  it("focuses the new epic's name field", () => {
    epics = [epic("new")];
    renderTab("new");
    const input = screen.getByDisplayValue(DEFAULT_EPIC_NAME) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
  });

  // Selected, not merely focused: the field holds the placeholder the product
  // wrote, so the first keystroke has to replace it rather than append to it.
  it("selects the placeholder text so typing replaces it", () => {
    epics = [epic("new")];
    renderTab("new");
    const input = screen.getByDisplayValue(DEFAULT_EPIC_NAME) as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(DEFAULT_EPIC_NAME.length);
  });

  it("focuses the new one, not some other row", () => {
    epics = [epic("old", { name: "Billing", y0: 50 }), epic("new", { y0: 400 })];
    renderTab("new");
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    const focused = inputs.find((i) => i === document.activeElement);
    expect(focused?.value).toBe(DEFAULT_EPIC_NAME);
  });
});

describe("it does not steal the caret", () => {
  // An epic re-selected later is already mounted, and taking focus then would
  // interrupt whatever the reader was typing.
  it("leaves focus alone when nothing is selected", () => {
    epics = [epic("a")];
    renderTab(null);
    expect(document.activeElement).toBe(document.body);
  });

  // Once named, an epic is no longer new — clicking it must not re-grab focus.
  it("leaves focus alone for a selected epic that is already named", () => {
    epics = [epic("a", { name: "Billing" })];
    renderTab("a");
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves focus alone for a selected epic that already holds work", () => {
    epics = [epic("a")];
    features = [{ id: "f1", epicId: "a", x: 0, duration: 5, y: 120, work: 1, status: "planned", resources: [] } as unknown as Feature];
    renderTab("a");
    expect(document.activeElement).toBe(document.body);
  });

  it("does not focus anything for a viewer who cannot edit", () => {
    epics = [epic("new")];
    render(
      <EpicsTab
        canEdit={false}
        epicFilter={new Set()}
        setEpicFilter={() => {}}
        onAddEpic={() => {}}
        selectedEpicId="new"
        onSelectEpic={() => {}}
      />,
    );
    expect(document.activeElement).toBe(document.body);
  });
});
