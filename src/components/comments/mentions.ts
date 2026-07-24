export interface MentionSuggestion {
  kind: "task" | "resource";
  id: string;
  label: string;
}

/** Recover the tasks/resources @-mentioned in `text` by scanning for "@Label".
 * Longer labels are matched first so "@Design System" wins over "@Design". */
export function detectMentions(text: string, suggestions: MentionSuggestion[]): MentionSuggestion[] {
  const out: MentionSuggestion[] = [];
  const seen = new Set<string>();
  for (const s of [...suggestions].sort((a, b) => b.label.length - a.label.length)) {
    const key = s.kind + ":" + s.id;
    if (s.label && !seen.has(key) && text.includes("@" + s.label)) {
      out.push(s);
      seen.add(key);
    }
  }
  return out;
}
