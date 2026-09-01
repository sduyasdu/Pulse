import { useMemo, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { usePulseStore, graphConfigOf, EPIC_PALETTE, DEFAULT_EPIC_NAME } from "@/stores/pulseStore";
import { epicBandsFor, isProvisionalEpic } from "@/domain/layout";
import { useDebouncedText } from "@/hooks/useDebouncedText";
import { confirmAt } from "@/stores/confirmStore";
import { useT } from "@/i18n";

interface EpicsTabProps {
  canEdit: boolean;
  /** The canvas's epic filter — the same set the toolbar's Epics dropdown
   * drives, so the two are one control in two places rather than two filters. */
  epicFilter: Set<string>;
  setEpicFilter: (v: Set<string>) => void;
  onAddEpic: () => void;
}

/** Debounced so typing doesn't write a Firestore doc per keystroke — the same
 * treatment the name field on the canvas band gets. */
function EpicName({ name, disabled, onCommit }: { name: string; disabled: boolean; onCommit: (v: string) => void }) {
  const t = useT();
  const [local, onChange] = useDebouncedText(name, onCommit);
  return (
    <input
      value={local}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t("epics.namePlaceholder")}
      title={local || t("epics.namePlaceholder")}
      className="min-w-0 flex-1 bg-transparent text-sm"
      style={{ color: "#1F2330", border: "none", outline: "none" }}
    />
  );
}

/**
 * Epics as a list you can actually work with.
 *
 * Everything here was already possible on the canvas, and awkward: the name
 * field lives inside a band that may be scrolled off-screen or sitting under a
 * task box, recolouring was not possible at all, and filtering by epic meant
 * the toolbar dropdown, which is a different place from where the epics are.
 *
 * The filter writes the SAME `epicFilter` the toolbar's dropdown does. Two
 * controls over one piece of state, deliberately — a second, tab-local epic
 * filter would silently disagree with the toolbar and with the canvas.
 */
export function EpicsTab({ canEdit, epicFilter, setEpicFilter, onAddEpic }: EpicsTabProps) {
  const t = useT();
  const epics = usePulseStore((s) => s.epics);
  const features = usePulseStore((s) => s.features);
  const pulse = usePulseStore((s) => s.pulse);
  // `graphConfigOf`, not a literal fallback: a different default here would
  // give bands a different geometry from the canvas's for the same Pulse.
  const graph = graphConfigOf(pulse);
  const patchEpic = usePulseStore((s) => s.patchEpic);
  const removeEpic = usePulseStore((s) => s.removeEpic);
  const [query, setQuery] = useState("");
  const [paletteFor, setPaletteFor] = useState<string | null>(null);

  // The task count comes from the same band computation the canvas uses, so the
  // number here and the one on the band cannot disagree.
  const bands = useMemo(
    () => epicBandsFor(epics, features, graph),
    [epics, features, graph],
  );

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (q ? bands.filter((b) => (b.name || "").toLowerCase().includes(q)) : bands), [bands, q]);

  const toggleFilter = (id: string) => {
    const next = new Set(epicFilter);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setEpicFilter(next);
  };

  return (
    <div className="p-3">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 rounded px-1.5" style={{ background: "#F4F7FB", border: "1px solid #E2DFD9" }}>
          <Icon name="search" size={13} style={{ color: "#64748B" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("epics.searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-xs"
            style={{ color: "#1F2330", outline: "none" }}
          />
          {query && (
            <button onClick={() => setQuery("")} className="no-press" title={t("epics.clearSearch")} aria-label={t("epics.clearSearch")} style={{ color: "#64748B", display: "flex" }}>
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
        {canEdit && (
          <button
            onClick={onAddEpic}
            className="hoverable mono flex flex-shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-semibold"
            style={{ background: "#F7E8DA", color: "#D85A28" }}
            title={t("toolbar.addEpic")}
          >
            <Icon name="view_agenda" size={13} /> {t("toolbar.addEpic")}
          </button>
        )}
      </div>

      {epicFilter.size > 0 && (
        <button
          onClick={() => setEpicFilter(new Set())}
          className="hoverable mb-2 flex w-full items-center justify-center gap-1 rounded py-1 text-xs font-semibold"
          style={{ background: "#FCEEE4", color: "#C2410C" }}
        >
          <Icon name="filter_alt" size={12} /> {t("epics.clearFilter", { n: epicFilter.size })}
        </button>
      )}

      {bands.length === 0 ? (
        <p className="px-1 py-6 text-center text-xs" style={{ color: "#94A3B8" }}>{t("epics.empty")}</p>
      ) : shown.length === 0 ? (
        <p className="px-1 py-6 text-center text-xs" style={{ color: "#94A3B8" }}>{t("epics.noMatch")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {shown.map((ep) => {
            const filtered = epicFilter.has(ep.id);
            const provisional = isProvisionalEpic(ep, DEFAULT_EPIC_NAME);
            return (
              <li
                key={ep.id}
                className="hoverable rounded-lg border p-2"
                style={{
                  borderColor: filtered ? "#EE7240" : "#E2DFD9",
                  background: filtered ? "#FFF8F3" : "#FFFFFF",
                }}
              >
                <div className="flex items-center gap-2">
                  {/* Swatch doubles as the colour picker's trigger. Disabled
                      for a viewer, who still sees the colour. */}
                  <button
                    onClick={() => canEdit && setPaletteFor((cur) => (cur === ep.id ? null : ep.id))}
                    disabled={!canEdit}
                    title={t("epics.color")}
                    aria-label={t("epics.color")}
                    className="no-press flex-shrink-0 rounded"
                    style={{ width: 14, height: 14, background: ep.color, border: "1px solid rgba(15,23,42,0.15)", cursor: canEdit ? "pointer" : "default" }}
                  />
                  <EpicName name={ep.name} disabled={!canEdit} onCommit={(name) => void patchEpic(ep.id, { name })} />
                  {provisional && (
                    <Icon name="info" size={12} title={t("epics.unfinished")} style={{ color: "#D85A28", flexShrink: 0 }} />
                  )}
                  <span className="mono flex-shrink-0 text-xs" style={{ color: "#64748B" }}>
                    {t(ep.count === 1 ? "epics.tasksOne" : "epics.tasksOther", { n: ep.count })}
                  </span>
                  {/* Always visible, never hover-revealed: on a touch device a
                      hover-only control is unreachable (see the hover-effects
                      skill, and PulseCard's menu for the same decision). */}
                  <button
                    onClick={() => toggleFilter(ep.id)}
                    title={filtered ? t("epics.filterOff") : t("epics.filterOn")}
                    aria-label={filtered ? t("epics.filterOff") : t("epics.filterOn")}
                    aria-pressed={filtered}
                    className="no-press flex flex-shrink-0 items-center"
                    style={{ color: filtered ? "#D85A28" : "#94A3B8" }}
                  >
                    <Icon name="filter_alt" size={14} />
                  </button>
                  {canEdit && (
                    <button
                      onClick={async (e) => {
                        if (await confirmAt(e, { message: t("epics.deleteConfirm", { name: ep.name || DEFAULT_EPIC_NAME }), detail: t("epics.deleteDetail") })) {
                          void removeEpic(ep.id);
                        }
                      }}
                      title={t("canvas.deleteEpic")}
                      aria-label={t("canvas.deleteEpic")}
                      className="no-press flex flex-shrink-0 items-center"
                      style={{ color: "#94A3B8" }}
                    >
                      <Icon name="delete" size={14} />
                    </button>
                  )}
                </div>

                {paletteFor === ep.id && canEdit && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {EPIC_PALETTE.map((c) => (
                      <button
                        key={c}
                        onClick={() => {
                          void patchEpic(ep.id, { color: c });
                          setPaletteFor(null);
                        }}
                        title={c}
                        aria-label={c}
                        className="no-press rounded"
                        style={{
                          width: 18,
                          height: 18,
                          background: c,
                          border: c === ep.color ? "2px solid #1F2330" : "1px solid rgba(15,23,42,0.15)",
                        }}
                      />
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
