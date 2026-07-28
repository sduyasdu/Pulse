import { describe, expect, it } from "vitest";
import { fold, hasLocalizedHelp, highlightRuns, sectionMatches } from "./index";
import { help } from "./en";
import type { HelpSection } from "./types";

const section = (over: Partial<HelpSection> = {}): HelpSection => ({
  id: "costs",
  title: "Costs",
  body: "AI spend is recorded per task.",
  bullets: [{ term: "Hourly rates", text: "Set in the Capacity tab." }],
  keywords: ["salary", "pay"],
  ...over,
});

describe("fold (HL12)", () => {
  it("strips accents and case so six languages search alike", () => {
    expect(fold("Período")).toBe("periodo");
    expect(fold("CAPACIDAD")).toBe("capacidad");
    // ö decomposes and loses its mark; ß needs an explicit ss, or a German reader
    // typing "grosse" would never find "Größe".
    expect(fold("Größe")).toBe("grosse");
    expect(fold("déplier")).toBe("deplier");
    expect(fold("attività")).toBe("attivita");
  });
});

describe("sectionMatches (HL11)", () => {
  it("matches the title, body and bullets", () => {
    expect(sectionMatches(section(), "costs")).toBe(true);
    expect(sectionMatches(section(), "recorded")).toBe(true);
    expect(sectionMatches(section(), "capacity")).toBe(true);
  });

  it("matches keywords the copy never uses — the point of having them", () => {
    // "salary" appears nowhere in the prose.
    expect(sectionMatches(section(), "salary")).toBe(true);
    expect(sectionMatches(section(), "pay")).toBe(true);
  });

  it("requires every term, so more words narrow rather than widen", () => {
    expect(sectionMatches(section(), "costs capacity")).toBe(true);
    expect(sectionMatches(section(), "costs epic")).toBe(false);
  });

  it("ignores case and accents", () => {
    expect(sectionMatches(section({ title: "Período" }), "periodo")).toBe(true);
    expect(sectionMatches(section(), "COSTS")).toBe(true);
  });

  it("matches everything on an empty query", () => {
    expect(sectionMatches(section(), "   ")).toBe(true);
  });
});

describe("highlightRuns (HL10 — markup stays out of the content)", () => {
  it("splits into non-match and match runs", () => {
    expect(highlightRuns("Costs and more", "costs")).toEqual([
      { text: "Costs", hit: true },
      { text: " and more", hit: false },
    ]);
  });

  it("marks every occurrence, and handles several terms", () => {
    const runs = highlightRuns("cost of a cost", "cost");
    expect(runs.filter((r) => r.hit).map((r) => r.text)).toEqual(["cost", "cost"]);
    expect(highlightRuns("hours and rate", "hours rate").filter((r) => r.hit)).toHaveLength(2);
  });

  it("returns one clean run when there's no query or no hit", () => {
    expect(highlightRuns("Costs", "")).toEqual([{ text: "Costs", hit: false }]);
    expect(highlightRuns("Costs", "epic")).toEqual([{ text: "Costs", hit: false }]);
  });

  it("highlights across accents, because folding a precomposed char keeps length 1:1", () => {
    expect(highlightRuns("période", "periode")).toEqual([{ text: "période", hit: true }]);
  });

  it("declines to highlight rather than mis-highlight when folding changes length", () => {
    // ß folds to two characters, so indices into the folded copy no longer line up
    // with the original — skip the highlight instead of marking the wrong span.
    expect(highlightRuns("Größe", "grosse")).toEqual([{ text: "Größe", hit: false }]);
    // ...while matching still finds it, which is what actually matters.
    expect(sectionMatches(section({ title: "Größe" }), "grosse")).toBe(true);
  });

  it("reassembles the original text exactly", () => {
    const text = "Hours × hourly cost, from the assignment.";
    expect(highlightRuns(text, "hourly").map((r) => r.text).join("")).toBe(text);
  });
});

describe("the English content itself", () => {
  it("ships all eight sections with unique ids", () => {
    expect(help.sections).toHaveLength(8);
    expect(new Set(help.sections.map((s) => s.id)).size).toBe(8);
  });

  it("keeps every section short — two sentences is the editorial rule", () => {
    help.sections.forEach((s) => {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.split(". ").length).toBeLessThanOrEqual(3);
    });
  });

  it("records what it was reviewed against, so staleness is visible", () => {
    expect(help.reviewedAgainst).toMatch(/^\d{4}-\d{2}$/);
  });

  it("is findable by the folk terms a newcomer would actually type", () => {
    const find = (q: string) => help.sections.filter((s) => sectionMatches(s, q)).map((s) => s.id);
    expect(find("gantt")).toContain("canvas");
    expect(find("salary")).toContain("costs");
    expect(find("zoom")).toContain("navigation");
    expect(find("kanban")).toContain("board");
    expect(find("permission")).toContain("collab");
    expect(find("baseline")).toContain("plan");
    expect(find("tall")).toContain("effort");
    expect(find("assign")).toContain("people");
  });

  it("serves English as the fallback for every other language", () => {
    expect(hasLocalizedHelp("en")).toBe(true);
    ["es", "pt", "fr", "it", "de", "zz"].forEach((l) => expect(hasLocalizedHelp(l)).toBe(false));
  });
});
