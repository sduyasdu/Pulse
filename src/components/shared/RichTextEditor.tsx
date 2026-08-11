import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { isRichTextEmpty, normalizeLinkHref, sanitizeRichText } from "@/domain/richText";
import { useT } from "@/i18n";

interface RichTextEditorProps {
  value: string;
  disabled?: boolean;
  placeholder?: string;
  minHeight?: number;
  onChange: (html: string) => void;
}

/** Height the expand toggle grows the writing surface to. */
const EXPANDED_HEIGHT = 260;

/** Lightweight rich-text field: a contentEditable surface plus a small
 * formatting toolbar (bold/italic/underline/strike, headings, lists, links,
 * clear). Stores HTML — sanitised on the way in *and* on the way out, because
 * a note written by one collaborator is rendered as markup in every other
 * member's browser (see domain/richText.ts).
 *
 * Uncontrolled internally — the DOM holds the text and we only push external
 * value changes in when the field isn't focused, so the caret never jumps.
 * Commits are debounced; blur and formatting actions flush immediately. */
export function RichTextEditor({ value, disabled, placeholder, minHeight = 60, onChange }: RichTextEditorProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const lastHtml = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  /** The caret at the moment the link button was pressed — focusing the URL
   * input destroys the editor's selection, so we put it back before wrapping. */
  const savedRange = useRef<Range | null>(null);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [onExistingLink, setOnExistingLink] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value !== lastHtml.current && document.activeElement !== el) {
      el.innerHTML = sanitizeRichText(value);
      lastHtml.current = value;
    }
  }, [value]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Light up the toolbar for whatever the caret is sitting in. Only while this
  // editor holds focus — several of them share the page.
  useEffect(() => {
    if (disabled) return;
    const sync = () => {
      const el = ref.current;
      if (!el || document.activeElement !== el) return;
      const state: Record<string, boolean> = {};
      for (const cmd of ["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList"]) {
        try {
          state[cmd] = document.queryCommandState(cmd);
        } catch {
          state[cmd] = false;
        }
      }
      state.heading = !!closestTag(el, "H3");
      state.link = !!closestTag(el, "A");
      setActive(state);
    };
    document.addEventListener("selectionchange", sync);
    return () => document.removeEventListener("selectionchange", sync);
  }, [disabled]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    // Normalise the browser's "empty" states (bare <br>, empty paragraph) to ""
    // so the placeholder shows and we don't persist junk markup.
    let html = el.innerHTML;
    if (isRichTextEmpty(html)) {
      if (html !== "") el.innerHTML = ""; // drop bare <br> etc. so the placeholder shows
      html = "";
    }
    // Sanitise what we store, not what is on screen: rewriting the live DOM
    // mid-keystroke would move the caret. Paste is already cleaned on entry, so
    // the two only diverge for markup the browser itself invented.
    const clean = html ? sanitizeRichText(html) : "";
    if (clean === lastHtml.current) return;
    lastHtml.current = clean;
    onChange(clean);
  };

  const scheduleEmit = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(emit, 500);
  };

  const flush = () => {
    window.clearTimeout(timer.current);
    emit();
  };

  const exec = (cmd: string, arg?: string) => {
    if (disabled) return;
    ref.current?.focus();
    // Ask for tags (<b>) rather than inline CSS (<span style>), which the
    // sanitiser would strip on save — the formatting would survive on screen
    // and vanish on reload.
    try {
      document.execCommand("styleWithCSS", false, "false");
    } catch {
      /* not supported everywhere; the default is already tag-based */
    }
    document.execCommand(cmd, false, arg);
    flush();
  };

  const toggleHeading = () => exec("formatBlock", closestTag(ref.current, "H3") ? "<p>" : "<h3>");

  const openLinkDraft = () => {
    if (disabled) return;
    const sel = document.getSelection();
    savedRange.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const existing = closestTag(ref.current, "A");
    setOnExistingLink(!!existing);
    setLinkDraft(existing?.getAttribute("href") ?? "");
  };

  /** Put the caret back where it was before the URL input stole focus, then
   * run `fn` against that selection. */
  const withSavedSelection = (fn: (sel: Selection | null) => void) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = document.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    fn(sel);
    flush();
  };

  const applyLink = () => {
    const href = normalizeLinkHref(linkDraft ?? "");
    setLinkDraft(null);
    if (!href) return;
    withSavedSelection((sel) => {
      // With nothing selected there is no text to wrap, so the URL becomes its
      // own label — otherwise createLink silently does nothing.
      if (sel?.isCollapsed) {
        const a = document.createElement("a");
        a.href = href;
        a.textContent = href;
        document.execCommand("insertHTML", false, `${a.outerHTML}&nbsp;`);
      } else {
        document.execCommand("createLink", false, href);
      }
    });
  };

  const removeLink = () => {
    setLinkDraft(null);
    withSavedSelection((sel) => {
      // `unlink` needs the anchor covered by the selection, and the caret
      // merely sitting inside it isn't enough — select the whole thing first.
      const anchor = closestTag(ref.current, "A");
      if (anchor && sel?.isCollapsed) {
        const range = document.createRange();
        range.selectNodeContents(anchor);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      document.execCommand("unlink");
    });
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const html = e.clipboardData.getData("text/html");
    // No HTML flavour — plain text, or a paste-and-match-style (⌘⇧V), which
    // drops the HTML from the clipboard before it reaches us. Let it through.
    if (!html) return;
    e.preventDefault();
    document.execCommand("insertHTML", false, sanitizeRichText(html));
    flush();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openLinkDraft();
    }
  };

  // Links are inert inside a contentEditable (clicking just places the caret),
  // so offer the usual modifier-click. Read-only notes open on a plain click.
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest?.("a");
    const href = anchor?.getAttribute("href");
    if (!href) return;
    if (disabled || e.metaKey || e.ctrlKey) {
      e.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="rounded" style={{ border: "1px solid #E2DFD9", background: disabled ? "#F8FAFC" : "#FFFFFF", overflow: "hidden" }}>
      {!disabled && (
        <div className="flex items-center gap-0.5 px-1 py-0.5 flex-wrap" style={{ borderBottom: "1px solid #F1F5F9", background: "#FBFAF7" }}>
          <FmtBtn label="B" title={t("editor.bold")} on={active.bold} onClick={() => exec("bold")} style={{ fontWeight: 800 }} />
          <FmtBtn label="I" title={t("editor.italic")} on={active.italic} onClick={() => exec("italic")} style={{ fontStyle: "italic" }} />
          <FmtBtn label="U" title={t("editor.underline")} on={active.underline} onClick={() => exec("underline")} style={{ textDecoration: "underline" }} />
          <FmtBtn label="S" title={t("editor.strike")} on={active.strikeThrough} onClick={() => exec("strikeThrough")} style={{ textDecoration: "line-through" }} />
          <Sep />
          <FmtBtn label="H" title={t("editor.heading")} on={active.heading} onClick={toggleHeading} style={{ fontWeight: 800 }} />
          <FmtBtn label={<Icon name="format_list_bulleted" size={13} />} title={t("editor.bulleted")} on={active.insertUnorderedList} onClick={() => exec("insertUnorderedList")} />
          <FmtBtn label="1." title={t("editor.numbered")} on={active.insertOrderedList} onClick={() => exec("insertOrderedList")} />
          <Sep />
          <FmtBtn label={<Icon name="link" size={13} />} title={t("editor.link")} on={active.link || linkDraft !== null} onClick={openLinkDraft} />
          <FmtBtn label={<Icon name="format_clear" size={13} />} title={t("editor.clear")} onClick={() => exec("removeFormat")} />
          <FmtBtn
            label={<Icon name={expanded ? "collapse_all" : "expand_all"} size={13} />}
            title={expanded ? t("editor.collapse") : t("editor.expand")}
            onClick={() => setExpanded((v) => !v)}
            style={{ marginLeft: "auto" }}
          />
        </div>
      )}
      {linkDraft !== null && !disabled && (
        <div className="flex items-center gap-1 px-1 py-1" style={{ borderBottom: "1px solid #F1F5F9", background: "#FFF7F1" }}>
          <input
            autoFocus
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); applyLink(); }
              if (e.key === "Escape") { e.preventDefault(); setLinkDraft(null); }
            }}
            placeholder={t("editor.linkPlaceholder")}
            className="text-xs flex-1 px-1.5 py-1 rounded border"
            style={{ borderColor: "#E2DFD9", outline: "none", minWidth: 0 }}
          />
          <button onClick={applyLink} className="mono text-xs px-2 py-1 rounded" style={{ background: "#F7E8DA", color: "#D85A28" }}>
            {t("editor.linkApply")}
          </button>
          {onExistingLink && (
            <button onClick={removeLink} title={t("editor.unlink")} className="flex items-center rounded" style={{ width: 22, height: 22, justifyContent: "center", background: "#FDEBEC" }}>
              <Icon name="delete" size={12} style={{ color: "#9F1D23" }} />
            </button>
          )}
          <button onClick={() => setLinkDraft(null)} title={t("common.cancel")} className="flex items-center">
            <Icon name="close" size={13} style={{ color: "#94A3B8" }} />
          </button>
        </div>
      )}
      <div
        ref={ref}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={scheduleEmit}
        // Drop the highlights too — several editors share the page, and a lit
        // "B" on an unfocused one describes a caret that is no longer there.
        onBlur={() => { flush(); setActive({}); }}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        onClick={onClick}
        data-placeholder={placeholder}
        className="rich-editor text-xs px-2 py-1.5"
        style={{
          minHeight: expanded ? EXPANDED_HEIGHT : minHeight,
          maxHeight: expanded ? EXPANDED_HEIGHT : undefined,
          overflowY: expanded ? "auto" : undefined,
          outline: "none",
          color: "#334155",
          overflowWrap: "anywhere",
        }}
      />
    </div>
  );
}

/** The nearest ancestor of the caret with `tag`, bounded by the editor. */
function closestTag(editor: HTMLElement | null, tag: string): HTMLElement | null {
  if (!editor) return null;
  const node = document.getSelection()?.anchorNode;
  if (!node || !editor.contains(node)) return null;
  const start = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  const found = start?.closest(tag) ?? null;
  return found && editor.contains(found) ? (found as HTMLElement) : null;
}

function Sep() {
  return <span style={{ width: 1, height: 14, background: "#E2DFD9", margin: "0 3px" }} />;
}

function FmtBtn({ label, title, onClick, style, on }: { label: React.ReactNode; title: string; onClick: () => void; style?: React.CSSProperties; on?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      // Keep the editor's selection alive: pointer-down on a toolbar button
      // must not steal focus / collapse the caret before execCommand runs.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="mono no-press rounded"
      style={{
        minWidth: 22,
        height: 20,
        fontSize: 11,
        color: on ? "#D85A28" : "#475569",
        background: on ? "#F7E8DA" : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      {label}
    </button>
  );
}
