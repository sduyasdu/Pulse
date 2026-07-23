import type { Epic, Feature, FeatureStatus, StatusDef } from "@/types";

export interface EpicGroup {
  epicId: string | null;
  name: string;
  color: string | null;
  tasks: Feature[];
}

export interface StatusColumn {
  status: FeatureStatus;
  label: string;
  count: number;
  groups: EpicGroup[]; // grouped by epic, each sorted by start date; "No epic" last
}

function byStart(a: Feature, b: Feature): number {
  return a.x - b.x || (a.title || "").localeCompare(b.title || "");
}

/**
 * Bucket features into one column per status (in the given `statuses` order, so
 * whatever order the Pulse defines — "done" last by convention). Each column's
 * tasks are grouped by epic and sorted by start date (Feature.x ascending, title
 * as tiebreak). Only epics with at least one task in that column get a band (in
 * `epics` array order); a "No epic" group (features with no/unknown epicId) is
 * appended last when it has tasks. Pure and side-effect-free — unit tested.
 */
export function buildBoard(features: Feature[], epics: Epic[], statuses: StatusDef[]): StatusColumn[] {
  const epicIds = new Set(epics.map((e) => e.id));
  return statuses.map((sd) => {
    const inCol = features.filter((f) => f.status === sd.id);
    const groups: EpicGroup[] = [];
    for (const ep of epics) {
      const tasks = inCol.filter((f) => f.epicId === ep.id).sort(byStart);
      if (tasks.length) groups.push({ epicId: ep.id, name: ep.name || "Untitled epic", color: ep.color, tasks });
    }
    const loose = inCol.filter((f) => !f.epicId || !epicIds.has(f.epicId)).sort(byStart);
    if (loose.length) groups.push({ epicId: null, name: "No epic", color: null, tasks: loose });
    return { status: sd.id, label: sd.label, count: inCol.length, groups };
  });
}
