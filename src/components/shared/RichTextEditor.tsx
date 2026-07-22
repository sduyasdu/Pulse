import { useEffect, useRef } from "react";

interface RichTextEditorProps {
  value: string;
  disabled?: boolean;
  placeholder?: string;
  minHeight?: number;
  onChange: (html: string) => void;
}

/** Lightweight rich-text field: a contentEditable surface plus a small
 * formatting toolbar (bold/italic/underline, lists, clear). Stores HTML.
 * Uncontrolled internally — the DOM holds the text and we only push external
 * value changes in when the field isn't focused, so the caret never jumps.
 * Commits are debounced; blur and formatting actions flush immediately. */
export function RichTextEditor({ value, disabled, placeholder, minHeight = 60, onChange }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const lastHtml = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value !== lastHtml.current && document.activeElement !== el) {
      el.innerHTML = value || "";
      lastHtml.current = value;
    }
  }, [value]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    // Normalise the browser's "empty" states (bare <br>, empty paragraph) to ""
    // so the placeholder shows and we don't persist junk markup.
    let html = el.innerHTML;
    if (!el.textContent?.trim() && !/<(img|li)/i.test(html)) {
      if (html !== "") el.innerHTML = ""; // drop bare <br> etc. so the placeholder shows
      html = "";
    }
    if (html === lastHtml.current) return;
    lastHtml.current = html;
    onChange(html);
  };

  const scheduleEmit = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(emit, 500);
  };

  const flush = () => {
    window.clearTimeout(timer.current);
    emit();
  };

  const exec = (cmd: string) => {
    if (disabled) return;
    ref.current?.focus();
    document.execCommand(cmd, false);
    flush();
  };

  return (
    <div className="rounded" style={{ border: "1px solid #E2DFD9", background: disabled ? "#F8FAFC" : "#FFFFFF", overflow: "hidden" }}>
      {!disabled && (
        <div className="flex items-center gap-0.5 px-1 py-0.5" style={{ borderBottom: "1px solid #F1F5F9", background: "#FBFAF7" }}>
          <FmtBtn label="B" title="Bold" onClick={() => exec("bold")} style={{ fontWeight: 800 }} />
          <FmtBtn label="I" title="Italic" onClick={() => exec("italic")} style={{ fontStyle: "italic" }} />
          <FmtBtn label="U" title="Underline" onClick={() => exec("underline")} style={{ textDecoration: "underline" }} />
          <span style={{ width: 1, height: 14, background: "#E2DFD9", margin: "0 3px" }} />
          <FmtBtn label="•" title="Bulleted list" onClick={() => exec("insertUnorderedList")} />
          <FmtBtn label="1." title="Numbered list" onClick={() => exec("insertOrderedList")} />
          <span style={{ width: 1, height: 14, background: "#E2DFD9", margin: "0 3px" }} />
          <FmtBtn label="⌫" title="Clear formatting" onClick={() => exec("removeFormat")} />
        </div>
      )}
      <div
        ref={ref}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={scheduleEmit}
        onBlur={flush}
        data-placeholder={placeholder}
        className="rich-editor text-xs px-2 py-1.5"
        style={{ minHeight, outline: "none", color: "#334155", overflowWrap: "anywhere" }}
      />
    </div>
  );
}

function FmtBtn({ label, title, onClick, style }: { label: string; title: string; onClick: () => void; style?: React.CSSProperties }) {
  return (
    <button
      type="button"
      title={title}
      // Keep the editor's selection alive: pointer-down on a toolbar button
      // must not steal focus / collapse the caret before execCommand runs.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="mono no-press rounded"
      style={{ minWidth: 22, height: 20, fontSize: 11, color: "#475569", display: "flex", alignItems: "center", justifyContent: "center", ...style }}
    >
      {label}
    </button>
  );
}
