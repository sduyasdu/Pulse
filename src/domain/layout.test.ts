import { describe, expect, it } from "vitest";
import { compactLayout, epicAtBox, epicBandsFor, stackRows } from "./layout";
import { DEFAULT_GRAPH_CONFIG } from "@/types";
import type { Epic } from "@/types";

const graph = DEFAULT_GRAPH_CONFIG;

function epic(id: string, y0: number, y1: number): Epic {
  return { id, name: id, color: "#000", y0, y1 };
}

describe("stackRows", () => {
  it("keeps non-overlapping rows in the same lane", () => {
    const rows = [
      { start: 0, duration: 3 },
      { start: 3, duration: 2 },
    ];
    const stacked = stackRows(rows);
    expect(stacked.map((r) => r.lane)).toEqual([0, 0]);
  });

  it("pushes overlapping rows into separate lanes", () => {
    const rows = [
      { start: 0, duration: 5 },
      { start: 2, duration: 3 },
    ];
    const stacked = stackRows(rows);
    expect(new Set(stacked.map((r) => r.lane)).size).toBe(2);
  });

  it("reuses a freed lane once its previous occupant ends", () => {
    const rows = [
      { start: 0, duration: 2 },
      { start: 0, duration: 5 }, // overlaps first -> lane 1
      { start: 2, duration: 2 }, // starts right when lane 0 frees up -> lane 0
    ];
    const stacked = stackRows(rows);
    const byStart2 = stacked.find((r) => r.start === 2 && r.duration === 2)!;
    expect(byStart2.lane).toBe(0);
  });
});

describe("epicBandsFor", () => {
  it("auto-fits an epic's extent to its features", () => {
    const epics = [epic("e1", 0, 100)];
    const features = [
      { id: "f1", x: 5, y: 40, duration: 10, epicId: "e1" },
      { id: "f2", x: 20, y: 100, duration: 5, epicId: "e1" },
    ];
    const [band] = epicBandsFor(epics, features, graph);
    expect(band.minX).toBe(5);
    expect(band.maxX).toBe(25);
    expect(band.count).toBe(2);
  });

  it("hugs the topmost feature instead of flooring the top at ep.y0", () => {
    // ep.y0 is 0, but the topmost feature sits well below it. The band top
    // must track the feature (f.y - 30), not stay pinned at ep.y0 — otherwise
    // dragging a task down leaves the epic's top edge stranded above it.
    const epics = [epic("e1", 0, 100)];
    const features = [{ id: "f1", x: 5, y: 400, duration: 10, epicId: "e1" }];
    const [band] = epicBandsFor(epics, features, graph);
    expect(band.y0).toBe(370); // 400 - 30, NOT 0
  });

  it("falls back to the base band when the epic has no features", () => {
    const epics = [epic("e1", 10, 20)];
    const [band] = epicBandsFor(epics, [], graph);
    expect(band.minX).toBeUndefined();
    expect(band.y1).toBe(10 + 90); // EPIC_MIN_H
  });

  it("manual overrides extend but never clip the auto-fit extent", () => {
    const epics = [{ ...epic("e1", 0, 100), manualY1: 50 }]; // smaller than auto-fit -> ignored
    const features = [{ id: "f1", x: 0, y: 0, duration: 5, epicId: "e1" }];
    const [band] = epicBandsFor(epics, features, graph);
    expect(band.y1).toBeGreaterThanOrEqual(50);

    const epics2 = [{ ...epic("e2", 0, 100), manualY1: 500 }]; // larger -> extends
    const [band2] = epicBandsFor(epics2, [{ ...features[0], epicId: "e2" }], graph);
    expect(band2.y1).toBe(500);
  });
});

describe("epicAtBox", () => {
  // A featureless epic collapses to [y0, y0+EPIC_MIN_H(90)] and has no
  // day-range, so it imposes no horizontal constraint.
  it("returns null when the box centre is outside every band", () => {
    const bands = epicBandsFor([epic("e1", 0, 50)], [], graph);
    expect(epicAtBox(bands, 10, 500)).toBeNull();
  });

  it("returns the band whose y-range contains the box centre", () => {
    const bands = epicBandsFor([epic("e1", 0, 200), epic("e2", 400, 600)], [], graph);
    expect(epicAtBox(bands, 10, 50)).toBe("e1"); // inside [0,90]
    expect(epicAtBox(bands, 10, 450)).toBe("e2"); // inside [400,490]
    expect(epicAtBox(bands, 10, 300)).toBeNull(); // in the gap between them
  });

  it("respects the band's horizontal extent, not just its y-range", () => {
    // Regression for the real bug. Live data: 'Drakaris' held features
    // spanning x=2392..2411 and y=520..855, while 'Connector in 3 days'
    // sat at x=2425 (clear to the RIGHT of Drakaris's rectangle) but at
    // y=657 — vertically inside it. A y-only hit-test called that "inside
    // Drakaris", so the box could be captured by (or stuck in) an epic it
    // visually sat well outside of.
    const feats = [
      { id: "a", x: 2392, y: 550, duration: 5, epicId: "drakaris", work: 2 },
      { id: "b", x: 2398, y: 762, duration: 5, epicId: "drakaris", work: 2 },
    ];
    const bands = epicBandsFor([epic("drakaris", 520, 824)], feats, graph);
    const band = bands[0];
    expect([band.minX, band.maxX]).toEqual([2392, 2403]);

    // vertically inside, horizontally inside -> in the epic
    expect(epicAtBox(bands, 2400, 657)).toBe("drakaris");
    // vertically inside, but horizontally past the band's right edge
    expect(epicAtBox(bands, 2425, 657)).toBeNull();
    // horizontally inside, but vertically above the band
    expect(epicAtBox(bands, 2400, 100)).toBeNull();
  });

  it("picks the most specific (smallest) band when a bloated one fully encloses a smaller one", () => {
    // Regression for the other real bug. An epic whose features are
    // scattered vertically auto-fits into a band tall enough to swallow its
    // neighbours whole — observed live: 'Conciliaciones Bancarias' spanned
    // y=26..374, fully containing 'Drakaris' at y=207..337. Under a
    // greatest-overlap-area rule the bloated band wins nearly everywhere, so
    // a box dropped squarely inside the small epic was still captured by the
    // big one, and could never be dragged out of it.
    const bloated = { ...epic("big", 26, 374), manualY1: 374 };
    const small = { ...epic("small", 207, 337), manualY1: 337 };
    const bands = epicBandsFor([bloated, small], [], graph);
    expect(bands.find((b) => b.id === "big")).toMatchObject({ y0: 26, y1: 374 });
    expect(bands.find((b) => b.id === "small")).toMatchObject({ y0: 207, y1: 337 });

    // dropped inside the small band, which the big one fully encloses:
    // the small (more specific) one must win
    expect(epicAtBox(bands, 0, 280)).toBe("small");
    // dropped where only the big band reaches
    expect(epicAtBox(bands, 0, 60)).toBe("big");
    // dropped below everything -> no epic
    expect(epicAtBox(bands, 0, 500)).toBeNull();
  });
});

describe("compactLayout", () => {
  it("packs non-overlapping features from the same epic into one lane", () => {
    const epics = [epic("e1", 0, 200)];
    const features = [
      { id: "f1", x: 0, y: 999, duration: 5, epicId: "e1", work: 1 },
      { id: "f2", x: 5, y: 999, duration: 5, epicId: "e1", work: 1 },
    ];
    const { featureYById } = compactLayout(epics, features, graph);
    expect(featureYById.f1).toBe(featureYById.f2);
  });

  it("stacks the epic bands one after another with a gap", () => {
    const epics = [epic("e1", 0, 200), epic("e2", 500, 700)];
    const { epics: newEpics } = compactLayout(epics, [], graph);
    const e1 = newEpics.find((e) => e.id === "e1")!;
    const e2 = newEpics.find((e) => e.id === "e2")!;
    expect(e2.y0).toBe(e1.y1 + 24); // EPIC_GAP
  });

  it("places loose (no-epic) features below every epic band", () => {
    const epics = [epic("e1", 0, 200)];
    const features = [{ id: "loose", x: 0, y: 999, duration: 3, epicId: null, work: 1 }];
    const { epics: newEpics, featureYById } = compactLayout(epics, features, graph);
    expect(featureYById.loose).toBeGreaterThan(newEpics[0].y1);
  });
});
