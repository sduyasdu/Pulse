import type { Epic, Feature, FeatureStatus } from "@/types";
import { STATUS_META } from "./constants";

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

// Column order follows STATUS_META (planned → in-progress → blocked → done),
// so "done" is always the terminal column.
const STATUS_KEYS = Object.keys(STATUS_META) as FeatureStatus[];

function byStart(a: Feature, b: Feature): number {
  return a.x - b.x || (a.title || "").localeCompare(b.title || "");
}

/**
 * Bucket features into status columns, each grouped by epic and sorted by start
 * date (Feature.x ascending, title as tiebreak). Epic groups follow the `epics`
 * array order; a "No epic" group (features with no/unknown epicId) is appended
 * last when non-empty. Pure and side-effect-free — unit tested.
 */
export function buildBoard(features: Feature[], epics: Epic[]): StatusColumn[] {
  const epicIds = new Set(epics.map((e) => e.id));
  return STATUS_KEYS.map((status) => {
    const inCol = features.filter((f) => f.status === status);
    const groups: EpicGroup[] = [];
    for (const ep of epics) {
      const tasks = inCol.filter((f) => f.epicId === ep.id).sort(byStart);
      if (tasks.length) groups.push({ epicId: ep.id, name: ep.name || "Untitled epic", color: ep.color, tasks });
    }
    const loose = inCol.filter((f) => !f.epicId || !epicIds.has(f.epicId)).sort(byStart);
    if (loose.length) groups.push({ epicId: null, name: "No epic", color: null, tasks: loose });
    return { status, label: STATUS_META[status].label, count: inCol.length, groups };
  });
}
