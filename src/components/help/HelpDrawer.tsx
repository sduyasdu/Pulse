// In-app help — Help-Spec.md §2. A right-hand drawer on desktop, full-screen on
// mobile (§6), holding a short summary of what Pulse does.
//
// The content is lazy-loaded on first open (§4), so nothing here costs anything
// until someone asks for help.
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { useI18nStore } from "@/stores/i18nStore";
import { hasLocalizedHelp, highlightRuns, loadHelp, sectionMatches, type HelpDoc } from "@/help";
import { useT } from "@/i18n";

/** Wraps search hits in <mark> without the content carrying any markup (HL10). */
function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  return (
    <>
      {highlightRuns(text, query).map((run, i) =>
        run.hit ? (
          <mark key={i} style={{ background: "#FDE68A", color: "inherit", padding: "0 1px", borderRadius: 2 }}>{run.text}</mark>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Where the panel sits:
 *  - `panel`      absolute inside a positioned shell — the Pulse page, where it
 *                 must start below the toolbar rather than cover it.
 *  - `fixed`      pinned to the viewport — the dashboard, which scrolls and has
 *                 no full-height shell to anchor to.
 *  - `fullScreen`  mobile.
 */
export type HelpPlacement = "panel" | "fixed" | "fullScreen";

export function HelpDrawer({ onClose, placement = "panel" }: { onClose: () => void; placement?: HelpPlacement }) {
  const t = useT();
  const lang = useI18nStore((s) => s.lang);
  const [doc, setDoc] = useState<HelpDoc | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    void loadHelp(lang).then((d) => {
      if (alive) setDoc(d);
    });
    return () => {
      alive = false;
    };
  }, [lang]);

  // Esc closes — matching every other overlay in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sections = useMemo(
    () => (doc ? doc.sections.filter((s) => sectionMatches(s, query)) : []),
    [doc, query],
  );

  const side: React.CSSProperties = {
    right: 0, top: 0, bottom: 0, width: 380, maxWidth: "92%",
    background: "#FFFFFF", borderLeft: "1px solid #E2DFD9",
    boxShadow: "-10px 0 28px rgba(15,23,42,0.10)",
    display: "flex", flexDirection: "column",
  };
  const frame: React.CSSProperties =
    placement === "fullScreen"
      ? { position: "fixed", inset: 0, zIndex: 60, background: "#FFFFFF", display: "flex", flexDirection: "column" }
      : placement === "fixed"
        ? { ...side, position: "fixed", zIndex: 60 }
        : { ...side, position: "absolute", zIndex: 40 };

  return (
    <div style={frame} role="dialog" aria-modal="false" aria-labelledby="help-title">
      <header className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0" style={{ borderColor: "#E2DFD9" }}>
        <Icon name="help" size={16} style={{ color: "#D85A28" }} />
        <span id="help-title" className="font-display text-sm font-semibold" style={{ color: "#1F2330" }}>{t("help.title")}</span>
        <button onClick={onClose} className="no-press" style={{ color: "#94A3B8", display: "flex", marginLeft: "auto" }} title={t("help.close")} aria-label={t("help.close")}>
          <Icon name="close" size={18} />
        </button>
      </header>

      {/* Search — pinned, so it stays put while the sections scroll (§2.1).
          Deliberately not auto-focused (HL13). */}
      <div className="px-3 py-2 flex-shrink-0" style={{ borderBottom: "1px solid #F1F5F9" }}>
        <div className="relative">
          <Icon name="search" size={15} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", pointerEvents: "none" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("help.searchPlaceholder")}
            className="w-full rounded-lg border text-sm"
            style={{ borderColor: "#E2DFD9", background: "#FFFFFF", color: "#1F2330", padding: "7px 30px 7px 30px", outline: "none" }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label={t("dashboard.clearSearch")}
              className="no-press"
              style={{ position: "absolute", right: 5, top: "50%", transform: "translateY(-50%)", width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", color: "#94A3B8" }}
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3" style={{ WebkitOverflowScrolling: "touch" }}>
        {!doc && <div className="mono text-xs" style={{ color: "#94A3B8" }}>{t("common.loading")}</div>}

        {doc && sections.length === 0 && (
          <div className="flex flex-col items-start gap-2">
            <span className="text-sm" style={{ color: "#64748B" }}>{t("help.noMatch", { query: query.trim() })}</span>
            <button onClick={() => setQuery("")} className="mono text-xs rounded px-2 py-1" style={{ background: "#F1F5F9", color: "#64748B" }}>
              {t("dashboard.clearSearch")}
            </button>
          </div>
        )}

        <div className="flex flex-col gap-4">
          {sections.map((s) => (
            <section key={s.id}>
              <h3 className="font-display text-sm font-semibold mb-1" style={{ color: "#123359" }}>
                <Highlighted text={s.title} query={query} />
              </h3>
              <p className="text-xs leading-relaxed" style={{ color: "#334155", margin: 0 }}>
                <Highlighted text={s.body} query={query} />
              </p>
              {s.bullets && (
                <ul className="flex flex-col gap-1 mt-1.5" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {s.bullets.map((b) => (
                    <li key={b.term} className="text-xs leading-relaxed" style={{ color: "#334155", paddingLeft: 10, borderLeft: "2px solid #EEF1F4" }}>
                      <span className="font-semibold" style={{ color: "#1F2330" }}><Highlighted text={b.term} query={query} /></span>
                      {" — "}
                      <Highlighted text={b.text} query={query} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        {doc && (
          <footer className="mono mt-5 pt-2" style={{ fontSize: 9, color: "#94A3B8", borderTop: "1px solid #F1F5F9" }}>
            {/* Say it plainly rather than silently serving English (§4). */}
            {!hasLocalizedHelp(lang) && <div>{t("help.englishOnly")}</div>}
            <div>{t("help.reviewed", { date: doc.reviewedAgainst })}</div>
          </footer>
        )}
      </div>
    </div>
  );
}
