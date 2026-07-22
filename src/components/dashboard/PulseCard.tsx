import { useState } from "react";
import { Link } from "react-router-dom";
import type { MyPulseIndexEntry } from "@/types";
import { PulseThumbnail } from "./PulseThumbnail";
import { usePulseSummary } from "./usePulseSummary";

const ROLE_LABEL: Record<MyPulseIndexEntry["role"], string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

interface PulseCardProps {
  entry: MyPulseIndexEntry;
  onInviteClick: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: (pt: { clientX: number; clientY: number }) => void;
}

export function PulseCard({ entry, onInviteClick, onArchive, onUnarchive, onDelete }: PulseCardProps) {
  const canInvite = entry.role === "owner" || entry.role === "editor";
  const isOwner = entry.role === "owner";
  const archived = !!entry.archived;
  const [menuOpen, setMenuOpen] = useState(false);
  const summary = usePulseSummary(entry.pulseId);
  const subtaskCount = summary?.features.reduce((n, f) => n + (f.children?.length ?? 0), 0) ?? 0;

  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className="group relative flex flex-col justify-between rounded-xl border p-4 transition-shadow hover:shadow-md"
      style={{ borderColor: "#E2DFD9", background: archived ? "#FAF9F5" : "#FFFFFF", minHeight: 108, opacity: archived ? 0.85 : 1 }}
    >
      {/* Actions menu — sits above the card's Link so it doesn't navigate. */}
      <div className="absolute right-2 top-2" style={{ zIndex: 10 }}>
        <button
          onClick={(e) => { stop(e); setMenuOpen((o) => !o); }}
          className="flex items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100"
          style={{ width: 26, height: 26, background: "#F4F2EC", color: "#64748B", fontSize: 18, lineHeight: 1, opacity: menuOpen ? 1 : undefined }}
          title="More actions"
          aria-label="More actions"
        >
          ⋯
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0" style={{ zIndex: 20 }} onClick={(e) => { stop(e); setMenuOpen(false); }} />
            <div
              className="absolute right-0 mt-1 rounded-lg border py-1"
              style={{ top: "100%", zIndex: 30, minWidth: 156, background: "#FFFFFF", borderColor: "#E2DFD9", boxShadow: "0 8px 24px rgba(15,23,42,0.14)" }}
            >
              {archived ? (
                <MenuItem label="Unarchive" onClick={(e) => { stop(e); setMenuOpen(false); onUnarchive(); }} />
              ) : (
                <MenuItem label="Archive" onClick={(e) => { stop(e); setMenuOpen(false); onArchive(); }} />
              )}
              {isOwner && (
                <MenuItem
                  label="Delete…"
                  danger
                  onClick={(e) => {
                    const pt = { clientX: e.clientX, clientY: e.clientY };
                    stop(e);
                    setMenuOpen(false);
                    onDelete(pt);
                  }}
                />
              )}
            </div>
          </>
        )}
      </div>

      <Link to={`/p/${entry.pulseId}`} className="flex-1">
        {summary ? (
          <PulseThumbnail features={summary.features} epics={summary.epics} />
        ) : (
          <div style={{ height: 56, background: "#FDFCF8", border: "1px solid #EEF1F4", borderRadius: 6 }} />
        )}
        <div className="font-display mt-2.5 text-sm font-medium text-yasdu-fg">{entry.name || "Untitled Pulse"}</div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="mono inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide" style={{ background: "#F7E8DA", color: "#D85A28" }}>
            {ROLE_LABEL[entry.role]}
          </span>
          {archived && (
            <span className="mono inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide" style={{ background: "#EEF1F5", color: "#64748B" }}>
              Archived
            </span>
          )}
        </div>
        {summary && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <StatBadge n={summary.epics.length} label="epic" bg="#EAF0FA" color="#1B3A63" />
            <StatBadge n={summary.features.length} label="task" bg="#FCEEE4" color="#C2410C" />
            <StatBadge n={subtaskCount} label="subtask" bg="#F1F5F9" color="#475569" />
            <StatBadge n={summary.resources.length} label="resource" bg="#E7F6F1" color="#0F766E" />
          </div>
        )}
      </Link>
      {canInvite && !archived && (
        <button
          onClick={onInviteClick}
          className="mono mt-3 self-start text-[11px] text-yasdu-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-yasdu-primary"
        >
          + invite collaborator
        </button>
      )}
    </div>
  );
}

function StatBadge({ n, label, bg, color }: { n: number; label: string; bg: string; color: string }) {
  return (
    <span className="mono inline-block rounded px-1.5 py-0.5 text-[10px]" style={{ background: bg, color }}>
      <span style={{ fontWeight: 700 }}>{n}</span> {label}{n === 1 ? "" : "s"}
    </span>
  );
}

function MenuItem({ label, danger, onClick }: { label: string; danger?: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button onClick={onClick} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-yasdu-secondary" style={{ color: danger ? "#DC2626" : "#334155" }}>
      {label}
    </button>
  );
}
