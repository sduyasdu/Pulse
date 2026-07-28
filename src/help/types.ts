// In-app help content shape — Help-Spec.md §4.
//
// Help prose lives here rather than in src/i18n, for two reasons: the
// dictionaries already compile to a ~109 KB chunk that loads on every page, and
// `Dict` is exact, so a missing key is a compile error — right for UI labels,
// wrong for prose that should fall back to English instead of blocking a build.
//
// Plain strings only (HL10): no HTML, no markdown, no parser, and no way for
// copy to smuggle in markup. Search highlighting is applied by the component.

export interface HelpBullet {
  term: string;
  text: string;
}

/** Stable section ids — never translated; they're the React keys and the anchors
 * a future context-sensitive open would jump to (HL7). */
export type HelpSectionId =
  | "canvas"
  | "effort"
  | "navigation"
  | "people"
  | "costs"
  | "plan"
  | "collab"
  | "board";

export interface HelpSection {
  id: HelpSectionId;
  title: string;
  body: string;
  bullets?: HelpBullet[];
  /** Folk terms a reader might search for that the copy doesn't use — "gantt",
   * "salary", "zoom". This is what makes search worth having over eight
   * sections (Help-Spec §2.1). */
  keywords?: string[];
}

export interface HelpDoc {
  /** Shown small at the foot of the panel so staleness is visible (§7). */
  reviewedAgainst: string;
  sections: HelpSection[];
}
