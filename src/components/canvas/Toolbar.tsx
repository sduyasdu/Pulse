import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { GraphConfig } from "@/types";
import type { Density } from "@/domain/constants";
import { clamp } from "@/domain/constants";
import { toDateInputValue, dayIndexFromDateInputValue } from "@/domain/dateUtils";
import { useDebouncedText } from "@/hooks/useDebouncedText";
import { useT } from "@/i18n";
import { MultiSelectFilter, type Option } from "@/components/shared/MultiSelectFilter";
import { SharePulseButton } from "@/components/shared/SharePulseButton";
import { Icon } from "@/components/shared/Icon";
import { PulseLockup } from "@/components/shared/Logo";

interface ToolbarProps {
  pulseName: string;
  onRenamePulse: (name: string) => void;
  onInvite: () => void;
  commentsOpen: boolean;
  onToggleComments: () => void;
  presence?: ReactNode;
  notifications?: ReactNode;
  viewMode: "canvas" | "board";
  setViewMode: (m: "canvas" | "board") => void;
  viewZoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  density: Density;
  setDensity: (d: Density) => void;
  onResetView: () => void;
  onFitRoadmap: () => void;
  referenceDay: number;
  onReferenceDayChange: (day: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  featureQuery: string;
  setFeatureQuery: (v: string) => void;
  featureStatusFilter: Set<string>;
  setFeatureStatusFilter: (v: Set<string>) => void;
  epicFilter: Set<string>;
  setEpicFilter: (v: Set<string>) => void;
  compactFilter: boolean;
  onToggleCompactFilter: () => void;
  myPulse: boolean;
  onToggleMyPulse: () => void;
  canMyPulse: boolean;
  epicOptions: Option[];
  statusOptions: Option[];
  showDelays: boolean;
  setShowDelays: (v: boolean) => void;
  epicsShrunk: boolean;
  onToggleShrinkEpics: () => void;
  onCompact: () => void;
  onAddEpic: () => void;
  onAddTask: () => void;
  graph: GraphConfig;
  onSetGraphConfig: (stepPx: number, workPerStep: number) => void;
  canEdit: boolean;
  roleLabel: string;
  /** Shared archive state — shows a chip beside the role, so the freeze stays
   * visible after the banner scrolls away (Hide-and-Archive-Spec §5.2). */
  archived?: boolean;
  /** Help is available to EVERY role — the button therefore sits outside the
   * canEdit block below, or viewers (who need it most) never see it. */
  helpOpen: boolean;
  onToggleHelp: () => void;
}

export function Toolbar({
  pulseName,
  onRenamePulse,
  onInvite,
  commentsOpen,
  onToggleComments,
  presence,
  notifications,
  viewMode,
  setViewMode,
  viewZoom,
  onZoomIn,
  onZoomOut,
  density,
  setDensity,
  onResetView,
  onFitRoadmap,
  referenceDay,
  onReferenceDayChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  featureQuery,
  setFeatureQuery,
  featureStatusFilter,
  setFeatureStatusFilter,
  epicFilter,
  setEpicFilter,
  compactFilter,
  onToggleCompactFilter,
  myPulse,
  onToggleMyPulse,
  canMyPulse,
  epicOptions,
  statusOptions,
  showDelays,
  setShowDelays,
  epicsShrunk,
  onToggleShrinkEpics,
  onCompact,
  onAddEpic,
  onAddTask,
  graph,
  onSetGraphConfig,
  canEdit,
  roleLabel,
  archived,
  helpOpen,
  onToggleHelp,
}: ToolbarProps) {
  const t = useT();
  const [showGraphSettings, setShowGraphSettings] = useState(false);
  const [name, onNameChange] = useDebouncedText(pulseName, onRenamePulse, 600);
  const densityLabel: Record<Density, string> = {
    day: t("toolbar.densityDay"),
    week: t("toolbar.densityWeek"),
    month: t("toolbar.densityMonth"),
  };

  return (
    <div className="flex flex-col flex-shrink-0 border-b" style={{ background: "#123359", borderColor: "#24406B" }}>
      <div className="flex items-center gap-3 px-4" style={{ height: 34, borderBottom: "1px solid #24406B" }}>
        <Link to="/" className="flex items-center gap-2" title={t("toolbar.backToDashboard")}>
          <PulseLockup variant="dark" size={15} />
        </Link>
        <div className="flex items-center gap-1" style={{ borderLeft: "1px solid #24406B", paddingLeft: 12 }}>
          <span className="font-display" style={{ color: "#EE7240", fontSize: 14, fontWeight: 500 }}>›</span>
          <input
            value={name}
            disabled={!canEdit}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t("toolbar.namePlaceholder")}
            title={t("toolbar.nameTitle")}
            className="font-display bg-transparent"
            style={{ color: "#F7F6F2", fontSize: 14, fontWeight: 500, letterSpacing: "-0.01em", outline: "none", border: "none", width: Math.max(140, (name.length || 14) * 8.5), minWidth: 140 }}
          />
        </div>
        <span className="mono px-2 py-0.5 rounded" style={{ fontSize: 9, background: "#1B3A63", color: "#94A3B8", textTransform: "uppercase" }}>{roleLabel}</span>
        {archived && (
          <span className="mono flex items-center gap-1 px-2 py-0.5 rounded" style={{ fontSize: 9, background: "#2A3F5F", color: "#CBD5E1", textTransform: "uppercase" }} title={t("pulse.archivedChip")}>
            <Icon name="archive" size={11} /> {t("pulse.archivedChip")}
          </span>
        )}
        <SharePulseButton name={pulseName} dark />
        {canEdit && (
          <button
            onClick={onInvite}
            className="flex items-center gap-1 px-2 py-0.5 rounded transition-colors hover:brightness-125"
            style={{ fontSize: 10, fontWeight: 600, background: "#1B3A63", color: "#EE7240", border: "1px solid #24406B" }}
            title={t("toolbar.inviteTitle")}
          >
            <Icon name="add" size={12} /> {t("toolbar.invite")}
          </button>
        )}
        <input
          type="date"
          value={toDateInputValue(referenceDay)}
          onChange={(e) => { const d = dayIndexFromDateInputValue(e.target.value); if (Number.isFinite(d)) onReferenceDayChange(d); }}
          title={t("toolbar.markerDate")}
          className="mono rounded px-2 py-0.5"
          style={{ colorScheme: "dark", fontSize: 10, background: "#1B3A63", color: "#EE7240", border: "1px solid #24406B", outline: "none" }}
        />
        <div className="flex rounded overflow-hidden" style={{ background: "#1B3A63" }} title={t("toolbar.switchView")}>
          {(["canvas", "board"] as const).map((m) => (
            <button key={m} onClick={() => setViewMode(m)} className="px-2.5 py-1 text-xs capitalize" style={{ background: viewMode === m ? "#EE7240" : "transparent", color: viewMode === m ? "#0A1428" : "#EE7240", fontWeight: 600 }}>
              {m === "canvas" ? t("toolbar.viewCanvas") : t("toolbar.viewBoard")}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={onToggleHelp}
          title={t("help.open")}
          aria-label={t("help.open")}
          aria-expanded={helpOpen}
          className="flex items-center justify-center rounded"
          style={{ width: 26, height: 26, flexShrink: 0, background: helpOpen ? "#EE7240" : "#1B3A63", color: helpOpen ? "#0A1428" : "#EE7240", border: "1px solid " + (helpOpen ? "#EE7240" : "#24406B") }}
        >
          <Icon name="help" size={14} />
        </button>
        {canEdit && (
          <div className="relative" style={{ flexShrink: 0 }}>
            <button onClick={() => setShowGraphSettings((v) => !v)} title={t("toolbar.effortScaleTitle")} className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold" style={{ background: showGraphSettings ? "#EE7240" : "#1B3A63", color: showGraphSettings ? "#0A1428" : "#EE7240", border: "1px solid " + (showGraphSettings ? "#EE7240" : "#24406B"), whiteSpace: "nowrap" }}>
              <Icon name="settings" size={13} /> {t("toolbar.effortScale")}
            </button>
            {showGraphSettings && (
              <div className="absolute z-50 mt-1 rounded-lg p-3" style={{ top: "100%", right: 0, width: 230, background: "#FFFFFF", border: "1px solid #E2DFD9", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
                <div className="mono text-xs font-semibold mb-2" style={{ color: "#1F2330" }}>{t("toolbar.effortScaleHeading")}</div>
                <label className="block mb-2">
                  <span className="mono" style={{ fontSize: 10, color: "#64748B" }}>{t("toolbar.pixelsPerStep")}</span>
                  <input
                    type="number"
                    min="6"
                    max="60"
                    step="1"
                    value={graph.stepPx}
                    onChange={(e) => onSetGraphConfig(clamp(parseInt(e.target.value || "16", 10), 6, 60), graph.workPerStep)}
                    className="w-full text-sm border rounded px-2 py-1 mt-0.5"
                    style={{ borderColor: "#E2DFD9", color: "#1F2330" }}
                  />
                </label>
                <label className="block">
                  <span className="mono" style={{ fontSize: 10, color: "#64748B" }}>{t("toolbar.workUnitsPerStep")}</span>
                  <input
                    type="number"
                    min="1"
                    max="40"
                    step="1"
                    value={graph.workPerStep}
                    onChange={(e) => onSetGraphConfig(graph.stepPx, clamp(parseInt(e.target.value || "1", 10), 1, 40))}
                    className="w-full text-sm border rounded px-2 py-1 mt-0.5"
                    style={{ borderColor: "#E2DFD9", color: "#1F2330" }}
                  />
                </label>
                <div className="mono mt-2" style={{ fontSize: 9, color: "#94A3B8" }}>
                  {t(graph.workPerStep > 1 ? "toolbar.effortScaleNoteOther" : "toolbar.effortScaleNoteOne", { px: graph.stepPx, n: graph.workPerStep })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-4" style={{ minHeight: 44, paddingTop: 5, paddingBottom: 5 }}>
        {/* Editing controls — wrap within their own flex-1 area so the
            collaboration cluster can stay pinned to the far right. */}
        <div className="flex flex-wrap items-center gap-1.5 flex-1" style={{ minWidth: 0 }}>
        {canEdit && viewMode === "canvas" && (
          <div className="flex items-center gap-1.5" style={{ borderRight: "1px solid #24406B", paddingRight: 6, marginRight: 2 }}>
            <button onClick={onAddEpic} className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold" style={{ background: "#1B3A63", color: "#EE7240", border: "1px solid #24406B" }}>
              <Icon name="view_agenda" size={14} /> {t("toolbar.addEpic")}
            </button>
            {/* #0A1428 like every other orange-filled button in this toolbar
                (view switch, help, effort scale, compact filter) — this was the
                only one on near-white, which also read at ~2.9:1 against the
                orange versus ~7:1 for the ink. */}
            <button onClick={onAddTask} className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-semibold" style={{ background: "#EE7240", color: "#0A1428" }}>
              {t("toolbar.addTask")}
            </button>
          </div>
        )}

        {/* My Beat — only tasks involving my linked account. */}
        <button
          onClick={onToggleMyPulse}
          disabled={!canMyPulse}
          title={canMyPulse ? t("toolbar.myBeatOn") : t("toolbar.myBeatOff")}
          className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold"
          style={{ background: myPulse ? "#EE7240" : "#1B3A63", color: myPulse ? "#0A1428" : "#EE7240", border: "1px solid " + (myPulse ? "#EE7240" : "#24406B"), opacity: canMyPulse ? 1 : 0.45, cursor: canMyPulse ? "pointer" : "not-allowed" }}
        >
          <Icon name="person" size={13} /> {t("toolbar.myBeat")}
        </button>
        {viewMode === "canvas" && (
          <>
        <div className="flex items-center gap-1 rounded px-1" style={{ background: "#1B3A63" }} title={t("toolbar.zoomTitle")}>
          <button onClick={onZoomOut} className="p-1.5 rounded"><Icon name="zoom_out" size={16} style={{ color: "#EE7240" }} /></button>
          <span className="mono text-xs w-9 text-center" style={{ color: "#EE7240" }}>{Math.round(viewZoom * 100)}%</span>
          <button onClick={onZoomIn} className="p-1.5 rounded"><Icon name="zoom_in" size={16} style={{ color: "#EE7240" }} /></button>
          <button onClick={onFitRoadmap} className="px-1.5 py-1 rounded mono text-xs" style={{ color: "#EE7240" }} title={t("toolbar.fitTitle")}>{t("toolbar.fit")}</button>
        </div>

        <div className="flex rounded overflow-hidden ml-1" style={{ background: "#1B3A63" }}>
          {(["day", "week", "month"] as Density[]).map((d) => (
            <button key={d} onClick={() => setDensity(d)} className="px-2.5 py-1.5 text-xs capitalize" style={{ background: density === d ? "#EE7240" : "transparent", color: density === d ? "#0A1428" : "#EE7240", fontWeight: 600 }}>
              {densityLabel[d]}
            </button>
          ))}
        </div>
        <button onClick={onResetView} className="p-1.5 rounded ml-1" style={{ background: "#1B3A63" }} title={t("toolbar.resetView")}><Icon name="refresh" size={16} style={{ color: "#EE7240" }} /></button>
          </>
        )}

        {canEdit && (
          <div className="flex items-center gap-1 rounded px-1 ml-1" style={{ background: "#1B3A63" }} title={t("toolbar.undoRedo")}>
            <button onClick={onUndo} disabled={!canUndo} className="p-1.5 rounded" title={t("toolbar.undo")} style={{ opacity: canUndo ? 1 : 0.5, cursor: canUndo ? "pointer" : "default" }}><Icon name="undo" size={16} style={{ color: "#EE7240" }} /></button>
            <button onClick={onRedo} disabled={!canRedo} className="p-1.5 rounded" title={t("toolbar.redo")} style={{ opacity: canRedo ? 1 : 0.5, cursor: canRedo ? "pointer" : "default" }}><Icon name="redo" size={16} style={{ color: "#EE7240" }} /></button>
          </div>
        )}

        <div className="flex items-center gap-1.5 ml-1">
          <div className="flex items-center gap-1 rounded px-1.5" style={{ background: "#F4F7FB", border: "1px solid #24406B" }}>
            <Icon name="search" size={13} style={{ color: "#64748B" }} />
            <input value={featureQuery} onChange={(e) => setFeatureQuery(e.target.value)} placeholder={t("toolbar.filterFeatures")} className="bg-transparent text-xs py-1.5" style={{ color: "#1F2330", outline: "none", width: 90 }} />
            {featureQuery && (
              <button onClick={() => setFeatureQuery("")} title={t("toolbar.clearTaskFilter")} aria-label={t("toolbar.clearTaskFilter")} className="no-press" style={{ color: "#64748B", display: "flex" }}>
                <Icon name="close" size={13} />
              </button>
            )}
          </div>
          <MultiSelectFilter
            label={t("toolbar.statuses")}
            dark
            options={statusOptions}
            selected={featureStatusFilter}
            onChange={setFeatureStatusFilter}
          />
          <MultiSelectFilter
            label={t("toolbar.epics")}
            searchable
            dark
            options={epicOptions}
            selected={epicFilter}
            onChange={setEpicFilter}
          />
          {(featureQuery || featureStatusFilter.size > 0 || epicFilter.size > 0) && (
            <button
              onClick={() => {
                setFeatureQuery("");
                setFeatureStatusFilter(new Set());
                setEpicFilter(new Set());
              }}
              title={t("toolbar.clearFeatureFilter")}
            >
              <Icon name="close" size={13} style={{ color: "#94A3B8" }} />
            </button>
          )}
        </div>
        {viewMode === "canvas" && (
          <>
            <button onClick={onToggleCompactFilter} title={t("toolbar.compactFilterTitle")} className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold" style={{ background: compactFilter ? "#EE7240" : "#1B3A63", color: compactFilter ? "#0A1428" : "#EE7240", border: "1px solid " + (compactFilter ? "#EE7240" : "#24406B") }}>
              <Icon name={compactFilter ? "collapse_all" : "expand_all"} size={13} /> {t("toolbar.compactFilter")}
            </button>
            <button onClick={() => setShowDelays(!showDelays)} title={t("toolbar.delaysTitle")} className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold" style={{ background: showDelays ? "#3A0E12" : "#1B3A63", color: showDelays ? "#FCA5A5" : "#EE7240", border: showDelays ? "1px solid #E5484D" : "1px solid #24406B" }}>
              <Icon name="timeline" size={13} /> {showDelays ? t("toolbar.delaysOn") : t("toolbar.delays")}
            </button>
            <button onClick={onToggleShrinkEpics} title={t("toolbar.shrinkTitle")} className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold" style={{ background: epicsShrunk ? "#123359" : "#1B3A63", color: "#EE7240", border: epicsShrunk ? "1px solid #EE7240" : "1px solid #24406B" }}>
              <Icon name="compress" size={13} /> {epicsShrunk ? t("toolbar.unshrink") : t("toolbar.shrinkEpics")}
            </button>
            {canEdit && (
              <button onClick={onCompact} title={t("toolbar.layoutTitle")} className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold" style={{ background: "#1B3A63", color: "#EE7240", border: "1px solid #24406B" }}>
                <Icon name="auto_awesome_mosaic" size={13} /> {t("toolbar.layout")}
              </button>
            )}
          </>
        )}
        </div>

        {/* Collaboration cluster — pinned to the far right of the row, in order:
            presence badges, comments toggle, notifications bell. */}
        <div className="flex items-center gap-2.5 flex-shrink-0" style={{ borderLeft: "1px solid #24406B", paddingLeft: 10 }}>
          {presence}
          <button
            onClick={onToggleComments}
            title={t("toolbar.comments")}
            className="flex items-center justify-center rounded-lg"
            style={{ width: 32, height: 32, background: commentsOpen ? "#EE7240" : "#1B3A63", color: commentsOpen ? "#0A1428" : "#EE7240", border: "1px solid " + (commentsOpen ? "#EE7240" : "#24406B") }}
          >
            <Icon name="forum" size={19} />
          </button>
          {notifications}
        </div>
      </div>
    </div>
  );
}
