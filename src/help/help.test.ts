import { describe, expect, it } from "vitest";
import { fold, hasLocalizedHelp, highlightRuns, loadHelp, sectionMatches } from "./index";
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

  it("has localized help for every supported language, and falls back beyond them", () => {
    SUPPORTED.forEach((l) => expect(hasLocalizedHelp(l)).toBe(true));
    // An unsupported code still resolves — to English — rather than throwing.
    expect(hasLocalizedHelp("zz")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Every locale, structurally
//
// The section ids are React keys and the anchors a context-sensitive open would
// jump to (HL7), so a translation that renames, drops or reorders one breaks
// more than its own text. These run against the real modules, so a locale that
// fails to parse or loses a section fails here rather than in someone's browser.
// ---------------------------------------------------------------------------

const SUPPORTED = ["en", "es", "pt", "fr", "it", "de"] as const;

describe("every localized help document", () => {
  it.each(SUPPORTED)("%s has the same sections, in the same order, as English", async (lang) => {
    const doc = await loadHelp(lang);
    expect(doc.sections.map((s) => s.id)).toEqual(help.sections.map((s) => s.id));
  });

  it.each(SUPPORTED)("%s carries the same bullet count per section as English", async (lang) => {
    const doc = await loadHelp(lang);
    // A dropped bullet is a silently missing instruction, and nothing else
    // would catch it — the shape is data, not types.
    doc.sections.forEach((s, i) => {
      expect(`${s.id}:${(s.bullets ?? []).length}`).toBe(`${help.sections[i].id}:${(help.sections[i].bullets ?? []).length}`);
    });
  });

  it.each(SUPPORTED)("%s is actually translated, not copied from English", async (lang) => {
    const doc = await loadHelp(lang);
    if (lang === "en") return;
    const titles = doc.sections.map((s) => s.title).join("|");
    expect(titles).not.toBe(help.sections.map((s) => s.title).join("|"));
  });

  it.each(SUPPORTED)("%s has no empty strings", async (lang) => {
    const doc = await loadHelp(lang);
    doc.sections.forEach((s) => {
      expect(s.title.trim()).not.toBe("");
      expect(s.body.trim()).not.toBe("");
      (s.bullets ?? []).forEach((b) => {
        expect(b.term.trim()).not.toBe("");
        expect(b.text.trim()).not.toBe("");
      });
    });
  });

  // Search is the reason keywords exist (Help-Spec §2.1): readers arrive with
  // their own vocabulary, so the keywords must be in THEIR language, not copied
  // from English.
  it.each(SUPPORTED)("%s keeps searchable keywords on the sections that carry them", async (lang) => {
    const doc = await loadHelp(lang);
    help.sections.forEach((enSection, i) => {
      if (!enSection.keywords?.length) return;
      expect(doc.sections[i].keywords?.length ?? 0).toBeGreaterThan(0);
    });
  });
});
