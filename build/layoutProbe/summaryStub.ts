import type { Epic, Feature, Resource } from "@/types";

/**
 * Stands in for `usePulseSummary` while the probe runs.
 *
 * The real one reads four Firestore collections. The probe has no Firebase (see
 * firebaseStub) and no data, and none of that changes the card's WIDTH — the
 * summary only decides whether the stat badges and the last-activity date are
 * present. So this returns a fixed, populated summary: badges rendered is the
 * wider of the two states, which is the one worth measuring.
 */
export interface PulseSummary {
  features: Feature[];
  epics: Epic[];
  resources: Resource[];
  lastActivityAt: number | null;
}

const feature = (id: string): Feature =>
  ({ id, title: "Task", x: 0, y: 0, duration: 5, work: 1, status: "planned", resources: [], children: [{ id: id + "s" }] }) as unknown as Feature;

const SUMMARY: PulseSummary = {
  features: [feature("f1"), feature("f2"), feature("f3")],
  epics: [{ id: "e1", name: "Epic", color: "#8B5CF6", y0: 0, y1: 100 }],
  resources: [{ id: "r1", name: "Ada" } as unknown as Resource],
  lastActivityAt: Date.UTC(2026, 7, 17),
};

export function usePulseSummary(): PulseSummary | null {
  return SUMMARY;
}
