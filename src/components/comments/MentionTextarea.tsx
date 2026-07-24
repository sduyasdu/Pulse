import { useRef, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import type { MentionSuggestion } from "./mentions";

interface Props {
  value: string;
  onChange: (v: string) => void;
  suggestions: MentionSuggestion[];
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  onSubmit?: () => void; // fired on ⌘/Ctrl+↵ (and plain ↵ when submitOnEnter)
  submitOnEnter?: boolean; // plain Enter submits (used by the quick reply box)
}

/** A textarea with "@" autocomplete over tasks and resources. Typing "@" opens
 * a suggestion menu filtered by what follows; picking one inserts "@Label " at
 * the caret. Mentions are recovered from the final text at submit time (by
 * scanning for "@Label"), so deleting the text simply removes the mention. */
export function MentionTextarea({ value, onChange, suggestions, placeholder, rows = 2, autoFocus, onSubmit, submitOnEnter }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null); // active "@token" (sans @), or null when not mentioning
  const [active, setActive] = useState(0);

  const matches =
    query == null
      ? []
      : suggestions.filter((s) => s.label.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  const syncQuery = (el: HTMLTextAreaElement) => {
    const upto = el.value.slice(0, el.selectionStart ?? el.value.length);
    const m = /@([^\s@]*)$/.exec(upto);
    setQuery(m ? m[1] : null);
    setActive(0);
  };

  const pick = (s: MentionSuggestion) => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@([^\s@]*)$/, `@${s.label} `);
    const next = before + value.slice(caret);
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };

  return (
    <div className="relative flex-1">
      <textarea
        ref={ref}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          syncQuery(e.target);
        }}
        onClick={(e) => syncQuery(e.currentTarget)}
        onKeyUp={(e) => syncQuery(e.currentTarget)}
        onKeyDown={(e) => {
          if (matches.length > 0) {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(matches[active]); return; }
            if (e.key === "Escape") { e.preventDefault(); setQuery(null); return; }
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit?.(); return; }
          if (submitOnEnter && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit?.(); }
        }}
        placeholder={placeholder}
        rows={rows}
        className="text-xs w-full rounded px-2 py-1.5"
        style={{ border: "1px solid #E2DFD9", outline: "none", color: "#334155", resize: "vertical" }}
      />
      {matches.length > 0 && (
        <div
          className="absolute z-50 rounded-lg border py-1"
          style={{ top: "100%", left: 0, marginTop: 4, minWidth: 180, maxWidth: 260, background: "#FFFFFF", borderColor: "#E2DFD9", boxShadow: "0 8px 24px rgba(15,23,42,0.14)" }}
        >
          {matches.map((s, i) => (
            <button
              key={s.kind + s.id}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-xs"
              style={{ background: i === active ? "#F1EFE8" : "transparent", color: "#334155" }}
            >
              <Icon name={s.kind === "task" ? "checklist" : "group"} size={13} style={{ color: "#94A3B8" }} />
              <span className="truncate">{s.label}</span>
              <span className="mono ml-auto" style={{ fontSize: 8, color: "#B4BECC", textTransform: "uppercase" }}>{s.kind}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
