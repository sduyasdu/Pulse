import { useState } from "react";
import { Link } from "react-router-dom";
import type { GraphConfig } from "@/types";
import type { Density } from "@/domain/constants";
import { DENSITY_HINT, clamp } from "@/domain/constants";
import { dateForDay, todayIndex } from "@/domain/dateUtils";
import { useDebouncedText } from "@/hooks/useDebouncedText";

interface ToolbarProps {
  pulseName: string;
  onRenamePulse: (name: string) => void;
  onInvite: () => void;
  viewZoom: number;
  setViewZoom: React.Dispatch<React.SetStateAction<number>>;
  scale: number;
  setScale: React.Dispatch<React.SetStateAction<number>>;
  density: Density;
  setDensity: (d: Density) => void;
  onResetView: () => void;
  onFitRoadmap: () => void;
  onJumpToToday: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  featureQuery: string;
  setFeatureQuery: (v: string) => void;
  featureStatusFilter: string;
  setFeatureStatusFilter: (v: string) => void;
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
}

const STATUS_OPTIONS = [
  { value: "planned", label: "Planned" },
  { value: "in-progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
];

export function Toolbar({
  pulseName,
  onRenamePulse,
  onInvite,
  viewZoom,
  setViewZoom,
  scale,
  setScale,
  density,
  setDensity,
  onResetView,
  onFitRoadmap,
  onJumpToToday,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  featureQuery,
  setFeatureQuery,
  featureStatusFilter,
  setFeatureStatusFilter,
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
}: ToolbarProps) {
  const [showGraphSettings, setShowGraphSettings] = useState(false);
  const [name, onNameChange] = useDebouncedText(pulseName, onRenamePulse, 600);

  return (
    <div className="flex flex-col flex-shrink-0 border-b" style={{ background: "#123359", borderColor: "#24406B" }}>
      <div className="flex items-center gap-3 px-4" style={{ height: 34, borderBottom: "1px solid #24406B" }}>
        <Link to="/" className="flex items-center gap-2" title="Back to dashboard">
          <span className="font-display text-white" style={{ fontWeight: 600, fontSize: 15, letterSpacing: "-0.02em" }}>Pulse</span>
          <span className="mono" style={{ fontSize: 8, color: "#F0A875", letterSpacing: "0.08em", textTransform: "uppercase", marginLeft: 2 }}>by Yasdu</span>
        </Link>
        <div className="flex items-center gap-1" style={{ borderLeft: "1px solid #24406B", paddingLeft: 12 }}>
          <span className="font-display" style={{ color: "#EE7240", fontSize: 14, fontWeight: 500 }}>›</span>
          <input
            value={name}
            disabled={!canEdit}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Nombrá este Pulse…"
            title="Name this Pulse"
            className="font-display bg-transparent"
            style={{ color: "#F7F6F2", fontSize: 14, fontWeight: 500, letterSpacing: "-0.01em", outline: "none", border: "none", width: Math.max(140, (name.length || 14) * 8.5), minWidth: 140 }}
          />
        </div>
        <span className="mono px-2 py-0.5 rounded" style={{ fontSize: 9, background: "#1B3A63", color: "#94A3B8", textTransform: "uppercase" }}>{roleLabel}</span>
        {canEdit && (
          <button
            onClick={onInvite}
            className="flex items-center gap-1 px-2 py-0.5 rounded transition-colors hover:brightness-125"
            style={{ fontSize: 10, fontWeight: 600, background: "#1B3A63", color: "#F0A875", border: "1px solid #24406B" }}
            title="Invite a collaborator to this Pulse"
          >
            <span style={{ fontSize: 11, lineHeight: 1 }}>＋</span> Invite
          </button>
        )}
        <button
          onClick={onJumpToToday}
          className="mono px-2 py-0.5 rounded transition-colors hover:brightness-125"
          style={{ fontSize: 9, background: "#1B3A63", color: "#F0A875" }}
          title="Jump the canvas back to today"
        >
          Today · {dateForDay(todayIndex()).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
        </button>
        <div className="flex-1" />
        <span className="mono px-2 py-0.5 rounded hidden md:inline" style={{ fontSize: 10, background: "#1B3A63", color: "#F0A875" }}>{DENSITY_HINT[density]}</span>
        {canEdit && (
          <div className="relative" style={{ flexShrink: 0 }}>
            <button onClick={() => setShowGraphSettings((v) => !v)} title="Graph Effort scale settings" className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold" style={{ background: showGraphSettings ? "#EE7240" : "#1B3A63", color: showGraphSettings ? "#0A1428" : "#F0A875", border: "1px solid " + (showGraphSettings ? "#EE7240" : "#24406B"), whiteSpace: "nowrap" }}>
              <span style={{ fontSize: 13, lineHeight: 1 }}>⚙️</span> Effort scale
            </button>
            {showGraphSettings && (
              <div className="absolute z-50 mt-1 rounded-lg p-3" style={{ top: "100%", right: 0, width: 230, background: "#FFFFFF", border: "1px solid #E2DFD9", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
                <div className="mono text-xs font-semibold mb-2" style={{ color: "#1F2330" }}>GRAPH EFFORT SCALE</div>
                <label className="block mb-2">
                  <span className="mono" style={{ fontSize: 10, color: "#64748B" }}>pixels per step</span>
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
                  <span className="mono" style={{ fontSize: 10, color: "#64748B" }}>work units per step</span>
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
                  Each {graph.stepPx}px of box height = {graph.workPerStep} work unit{graph.workPerStep > 1 ? "s" : ""}. Height is discrete (whole steps).
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 px-4" style={{ minHeight: 44, paddingTop: 5, paddingBottom: 5, overflowX: "auto" }}>
        {canEdit && (
          <div className="flex items-center gap-1.5" style={{ borderRight: "1px solid #24406B", paddingRight: 6, marginRight: 2 }}>
            <button onClick={onAddEpic} className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold" style={{ background: "#1B3A63", color: "#F0A875", border: "1px solid #24406B" }}>
              ▤ Add epic
            </button>
            <button onClick={onAddTask} className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-semibold" style={{ background: "#EE7240", color: "#FDFDFD" }}>
              + Add task
            </button>
          </div>
        )}
        <div className="flex items-center gap-1 rounded px-1" style={{ background: "#1B3A63" }} title="Zoom the whole canvas image in/out (day width unchanged)">
          <button onClick={() => setViewZoom((z) => clamp(Math.round((z - 0.15) * 100) / 100, 0.2, 2))} className="p-1.5 rounded"><span style={{ color: "#F0A875", fontSize: 14 }}>🔍−</span></button>
          <span className="mono text-xs w-9 text-center" style={{ color: "#F0A875" }}>{Math.round(viewZoom * 100)}%</span>
          <button onClick={() => setViewZoom((z) => clamp(Math.round((z + 0.15) * 100) / 100, 0.2, 2))} className="p-1.5 rounded"><span style={{ color: "#F0A875", fontSize: 14 }}>🔍+</span></button>
          <button onClick={onFitRoadmap} className="px-1.5 py-1 rounded mono text-xs" style={{ color: "#F0A875" }} title="Fit the whole roadmap on screen">fit</button>
        </div>

        <div className="flex items-center gap-1 rounded px-1 ml-1" style={{ background: "#1B3A63" }} title="Stretch or compress the day scale">
          <button onClick={() => setScale((s) => clamp(s / 1.2, 0.4, 2.5))} className="p-1.5 rounded"><span style={{ color: "#CBD5E1", fontSize: 14 }}>−</span></button>
          <span className="mono text-xs w-9 text-center" style={{ color: "#64748B" }}>{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => clamp(s * 1.2, 0.4, 2.5))} className="p-1.5 rounded"><span style={{ color: "#CBD5E1", fontSize: 14 }}>+</span></button>
        </div>

        <div className="flex rounded overflow-hidden ml-1" style={{ background: "#1B3A63" }}>
          {(["day", "week", "month"] as Density[]).map((d) => (
            <button key={d} onClick={() => setDensity(d)} className="px-2.5 py-1.5 text-xs capitalize" style={{ background: density === d ? "#EE7240" : "transparent", color: density === d ? "#0A1428" : "#64748B", fontWeight: 600 }}>
              {d}
            </button>
          ))}
        </div>
        <button onClick={onResetView} className="p-1.5 rounded ml-1" style={{ background: "#1B3A63" }} title="Reset view"><span style={{ color: "#CBD5E1", fontSize: 14 }}>⟲</span></button>

        {canEdit && (
          <div className="flex items-center gap-1 rounded px-1 ml-1" style={{ background: "#1B3A63" }} title="Undo / redo (⌘Z · ⇧⌘Z)">
            <button onClick={onUndo} disabled={!canUndo} className="p-1.5 rounded" title="Undo (⌘Z)" style={{ opacity: canUndo ? 1 : 0.35, cursor: canUndo ? "pointer" : "default" }}><span style={{ color: "#F0A875", fontSize: 14 }}>↶</span></button>
            <button onClick={onRedo} disabled={!canRedo} className="p-1.5 rounded" title="Redo (⇧⌘Z)" style={{ opacity: canRedo ? 1 : 0.35, cursor: canRedo ? "pointer" : "default" }}><span style={{ color: "#F0A875", fontSize: 14 }}>↷</span></button>
          </div>
        )}

        <div className="flex items-center gap-1 rounded px-1.5 ml-1" style={{ background: "#1B3A63", border: "1px solid #24406B" }}>
          <span style={{ fontSize: 12, color: "#64748B" }}>🔍</span>
          <input value={featureQuery} onChange={(e) => setFeatureQuery(e.target.value)} placeholder="filter features…" className="bg-transparent text-xs py-1.5" style={{ color: "#E2E8F0", outline: "none", width: 90 }} />
          <select value={featureStatusFilter} onChange={(e) => setFeatureStatusFilter(e.target.value)} className="bg-transparent text-xs py-1.5" style={{ color: "#F0A875", outline: "none" }}>
            <option value="all" style={{ color: "#000" }}>all</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value} style={{ color: "#000" }}>{s.label}</option>
            ))}
          </select>
          {(featureQuery || featureStatusFilter !== "all") && (
            <button
              onClick={() => {
                setFeatureQuery("");
                setFeatureStatusFilter("all");
              }}
              title="Clear feature filter"
            >
              <span style={{ fontSize: 11, color: "#64748B" }}>✕</span>
            </button>
          )}
        </div>
        <button onClick={() => setShowDelays(!showDelays)} title="Show delay lines: planned start → actual start" className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold" style={{ background: showDelays ? "#3A0E12" : "#1B3A63", color: showDelays ? "#FCA5A5" : "#F0A875", border: showDelays ? "1px solid #E5484D" : "1px solid #24406B" }}>
          ⟞ {showDelays ? "Delays on" : "Delays"}
        </button>
        <button onClick={onToggleShrinkEpics} title="Shrink epics to title-only boxes and compact their height" className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold" style={{ background: epicsShrunk ? "#123359" : "#1B3A63", color: "#F0A875", border: epicsShrunk ? "1px solid #EE7240" : "1px solid #24406B" }}>
          {epicsShrunk ? "▣" : "▢"} {epicsShrunk ? "Unshrink" : "Shrink epics"}
        </button>
        {canEdit && (
          <button onClick={onCompact} title="Compact everything vertically to minimum height" className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold" style={{ background: "#1B3A63", color: "#F0A875", border: "1px solid #24406B" }}>
            ⇕ Compact
          </button>
        )}
      </div>
    </div>
  );
}
