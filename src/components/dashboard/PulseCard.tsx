import { useState } from "react";
import { Icon } from "@/components/shared/Icon";
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
  onDuplicateClick: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: (pt: { clientX: number; clientY: number }) => void;
  onLeave: (pt: { clientX: number; clientY: number }) => void;
}

export function PulseCard({ entry, onInviteClick, onDuplicateClick, onArchive, onUnarchive, onDelete, onLeave }: PulseCardProps) {
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
      {/* Actions menu — bottom-right, always visible, sits above the card's
          Link so it doesn't navigate. Opens upward so it doesn't overflow. */}
      <div className="absolute right-2 bottom-2" style={{ zIndex: 10 }}>
        <button
          onClick={(e) => { stop(e); setMenuOpen((o) => !o); }}
          className="flex items-center justify-center rounded"
          style={{ width: 26, height: 26, background: "#F1EFE8", color: "#64748B", fontSize: 18, lineHeight: 1, border: "1px solid #E2DFD9" }}
          title="More actions"
          aria-label="More actions"
        >
          <Icon name="more_horiz" size={18} />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0" style={{ zIndex: 20 }} onClick={(e) => { stop(e); setMenuOpen(false); }} />
            <div
              className="absolute right-0 mb-1 rounded-lg border py-1"
              style={{ bottom: "100%", zIndex: 30, minWidth: 168, background: "#FFFFFF", borderColor: "#E2DFD9", boxShadow: "0 8px 24px rgba(15,23,42,0.14)" }}
            >
              {canInvite && !archived && (
                <MenuItem label="Invite collaborator" icon="person_add" onClick={(e) => { stop(e); setMenuOpen(false); onInviteClick(); }} />
              )}
              <MenuItem label="Duplicate…" icon="content_copy" onClick={(e) => { stop(e); setMenuOpen(false); onDuplicateClick(); }} />
              {archived ? (
                <MenuItem label="Unarchive" icon="unarchive" onClick={(e) => { stop(e); setMenuOpen(false); onUnarchive(); }} />
              ) : (
                <MenuItem label="Archive" icon="archive" onClick={(e) => { stop(e); setMenuOpen(false); onArchive(); }} />
              )}
              {isOwner ? (
                <MenuItem
                  label="Delete…"
                  icon="delete"
                  danger
                  onClick={(e) => {
                    const pt = { clientX: e.clientX, clientY: e.clientY };
                    stop(e);
                    setMenuOpen(false);
                    onDelete(pt);
                  }}
                />
              ) : (
                <MenuItem
                  label="Leave Pulse"
                  icon="logout"
                  danger
                  onClick={(e) => {
                    const pt = { clientX: e.clientX, clientY: e.clientY };
                    stop(e);
                    setMenuOpen(false);
                    onLeave(pt);
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
        {/* The section already conveys ownership, so the "Owner" badge is
            redundant — only show Editor/Viewer (and the archived tag). */}
        {(!isOwner || archived) && (
          <div className="mt-1.5 flex items-center gap-1.5">
            {!isOwner && (
              <span className="mono inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide" style={{ background: "#F7E8DA", color: "#D85A28" }}>
                {ROLE_LABEL[entry.role]}
              </span>
            )}
            {archived && (
              <span className="mono inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide" style={{ background: "#EEF1F5", color: "#64748B" }}>
                Archived
              </span>
            )}
          </div>
        )}
        {summary && (
          <div className="mt-2 flex flex-wrap items-center gap-1" style={{ paddingRight: 30 }}>
            <StatBadge n={summary.epics.length} label="epic" bg="#EAF0FA" color="#1B3A63" />
            <StatBadge n={summary.features.length} label="task" bg="#FCEEE4" color="#C2410C" />
            <StatBadge n={subtaskCount} label="subtask" bg="#F1F5F9" color="#475569" />
            <StatBadge n={summary.resources.length} label="resource" bg="#E7F6F1" color="#0F766E" />
          </div>
        )}
      </Link>
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

function MenuItem({ label, icon, danger, onClick }: { label: string; icon: string; danger?: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-yasdu-secondary" style={{ color: danger ? "#DC2626" : "#334155" }}>
      <Icon name={icon} size={15} style={{ color: danger ? "#DC2626" : "#64748B" }} />
      {label}
    </button>
  );
}
