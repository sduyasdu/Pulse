import { describe, it, expect } from "vitest";
import type { Epic, Feature, FeatureStatus } from "@/types";
import { DEFAULT_STATUSES } from "./constants";
import { buildBoard } from "./kanban";

let n = 0;
function mk(status: FeatureStatus, x: number, epicId: string | null, title = `t${n}`): Feature {
  return { id: `f${n++}`, title, x, y: 0, duration: 5, status, resources: [], epicId };
}
function epic(id: string, name = id): Epic {
  return { id, name, color: "#123456", y0: 0, y1: 100 } as Epic;
}
const board = (features: Feature[], epics: Epic[]) => buildBoard(features, epics, DEFAULT_STATUSES);

describe("buildBoard", () => {
  it("produces the four status columns in order, done last", () => {
    const cols = board([], []);
    expect(cols.map((c) => c.status)).toEqual(["planned", "in-progress", "blocked", "done"]);
    expect(cols.every((c) => c.count === 0 && c.groups.length === 0)).toBe(true);
  });

  it("buckets by status and counts", () => {
    const cols = board([mk("planned", 1, null), mk("planned", 2, null), mk("done", 3, null)], []);
    expect(cols.find((c) => c.status === "planned")!.count).toBe(2);
    expect(cols.find((c) => c.status === "done")!.count).toBe(1);
    expect(cols.find((c) => c.status === "blocked")!.count).toBe(0);
  });

  it("groups by epic (array order) with a trailing 'No epic' group", () => {
    const epics = [epic("A"), epic("B")];
    const feats = [mk("planned", 1, "B"), mk("planned", 1, null), mk("planned", 1, "A")];
    const planned = board(feats, epics).find((c) => c.status === "planned")!;
    expect(planned.groups.map((g) => g.epicId)).toEqual(["A", "B", null]);
    expect(planned.groups.at(-1)!.name).toBe("No epic");
  });

  it("sorts tasks within a group by start date, then title", () => {
    const epics = [epic("A")];
    const feats = [mk("planned", 9, "A", "late"), mk("planned", 2, "A", "early"), mk("planned", 2, "A", "also")];
    const g = board(feats, epics).find((c) => c.status === "planned")!.groups[0];
    expect(g.tasks.map((t) => t.title)).toEqual(["also", "early", "late"]);
  });

  it("treats an unknown epicId as 'No epic'", () => {
    const feats = [mk("planned", 1, "ghost")];
    const planned = board(feats, [epic("A")]).find((c) => c.status === "planned")!;
    const noEpic = planned.groups.find((g) => g.epicId === null);
    expect(noEpic?.tasks).toHaveLength(1);
  });

  it("shows a populated epic only where it has tasks, but an empty epic everywhere", () => {
    const epics = [epic("A"), epic("B")]; // A gets a planned task; B stays empty
    const cols = board([mk("planned", 1, "A")], epics);
    const planned = cols.find((c) => c.status === "planned")!;
    const blocked = cols.find((c) => c.status === "blocked")!;
    expect(planned.groups.map((g) => g.epicId)).toEqual(["A", "B"]); // A has a task, B empty-everywhere
    expect(blocked.groups.map((g) => g.epicId)).toEqual(["B"]); // A not here; B still shown (brand new)
  });
});
