import { useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { Link } from "react-router-dom";
import { hiddenOf, type MyPulseIndexEntry } from "@/types";
import { roleMeta } from "@/domain/permissions";
import { useT, type TranslationKey } from "@/i18n";
import { PulseThumbnail } from "./PulseThumbnail";
import { usePulseSummary } from "./usePulseSummary";

interface PulseCardProps {
  entry: MyPulseIndexEntry;
  onRenameClick: () => void;
  onInviteClick: () => void;
  onDuplicateClick: () => void;
  onHide: () => void;
  onUnhide: () => void;
  onArchive: (pt: { clientX: number; clientY: number }) => void;
  onUnarchive: () => void;
  onDelete: (pt: { clientX: number; clientY: number }) => void;
  onLeave: (pt: { clientX: number; clientY: number }) => void;
}

export function PulseCard({ entry, onRenameClick, onInviteClick, onDuplicateClick, onHide, onUnhide, onArchive, onUnarchive, onDelete, onLeave }: PulseCardProps) {
  const t = useT();
  const canInvite = entry.role === "owner" || entry.role === "editor";
  const isOwner = entry.role === "owner";
  // Two independent states (Hide-and-Archive-Spec §2.1): `hidden` is yours
  // alone and changes nothing; `archived` is shared and freezes the Pulse for
  // everyone. The card can show both at once.
  const hidden = hiddenOf(entry);
  const archived = (entry.archivedAt ?? null) !== null;
  const dimmed = hidden || archived;
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
      style={{ borderColor: "#E2DFD9", background: dimmed ? "#FAF9F5" : "#FFFFFF", minHeight: 108, opacity: dimmed ? 0.85 : 1 }}
    >
      {/* Actions menu — bottom-right, always visible, sits above the card's
          Link so it doesn't navigate. Opens upward so it doesn't overflow. */}
      <div className="absolute right-2 bottom-2" style={{ zIndex: 10 }}>
        <button
          onClick={(e) => { stop(e); setMenuOpen((o) => !o); }}
          className="flex items-center justify-center rounded"
          style={{ width: 26, height: 26, background: "#F1EFE8", color: "#64748B", fontSize: 18, lineHeight: 1, border: "1px solid #E2DFD9" }}
          title={t("card.moreActions")}
          aria-label={t("card.moreActions")}
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
              {/* Rename and Invite both write the (frozen) Pulse doc, so they
                  go while archived. Duplicate stays: it writes a new, active
                  Pulse and never touches this one. */}
              {canInvite && !archived && (
                <MenuItem label={t("card.rename")} icon="edit" onClick={(e) => { stop(e); setMenuOpen(false); onRenameClick(); }} />
              )}
              {canInvite && !archived && (
                <MenuItem label={t("card.inviteCollaborator")} icon="person_add" onClick={(e) => { stop(e); setMenuOpen(false); onInviteClick(); }} />
              )}
              <MenuItem label={t("card.duplicate")} icon="content_copy" onClick={(e) => { stop(e); setMenuOpen(false); onDuplicateClick(); }} />
              {hidden ? (
                <MenuItem label={t("card.unhide")} icon="visibility" onClick={(e) => { stop(e); setMenuOpen(false); onUnhide(); }} />
              ) : (
                <MenuItem label={t("card.hide")} icon="visibility_off" onClick={(e) => { stop(e); setMenuOpen(false); onHide(); }} />
              )}
              {/* Archive is owner-only (HA1): it makes the Pulse read-only for
                  every member, so it sits with the role that already carries the
                  other Pulse-wide consequences. */}
              {isOwner && (archived ? (
                <MenuItem label={t("card.unarchive")} icon="unarchive" onClick={(e) => { stop(e); setMenuOpen(false); onUnarchive(); }} />
              ) : (
                <MenuItem
                  label={t("card.archive")}
                  icon="archive"
                  onClick={(e) => {
                    const pt = { clientX: e.clientX, clientY: e.clientY };
                    stop(e);
                    setMenuOpen(false);
                    onArchive(pt);
                  }}
                />
              ))}
              {isOwner ? (
                <MenuItem
                  label={t("card.delete")}
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
                  label={t("card.leavePulse")}
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
        <div className="font-display mt-2.5 text-sm font-medium text-yasdu-fg">{entry.name || t("common.untitledPulse")}</div>
        {/* The section already conveys ownership, so the "Owner" badge is
            redundant — only show Editor/Viewer (and the state tags). Archived
            reads louder than Hidden: it's a fact about the Pulse everyone can
            see, where Hidden is just this user's filing. */}
        {(!isOwner || archived || hidden) && (
          <div className="mt-1.5 flex items-center gap-1.5">
            {!isOwner && (
              <span className="mono inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide" style={{ background: "#F7E8DA", color: "#D85A28" }}>
                {roleMeta(entry.role).label}
              </span>
            )}
            {archived && (
              <span className="mono inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide" style={{ background: "#E3E8F0", color: "#475569" }}>
                {t("card.archivedTag")}
              </span>
            )}
            {hidden && (
              <span className="mono inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide" style={{ background: "#F4F5F7", color: "#94A3B8" }}>
                {t("card.hiddenTag")}
              </span>
            )}
          </div>
        )}
        {summary && (
          <div className="mt-2 flex flex-wrap items-center gap-1" style={{ paddingRight: 30 }}>
            <StatBadge n={summary.epics.length} text={countLabel(t, "card.epicOne", "card.epicOther", summary.epics.length)} bg="#EAF0FA" color="#1B3A63" />
            <StatBadge n={summary.features.length} text={countLabel(t, "card.taskOne", "card.taskOther", summary.features.length)} bg="#FCEEE4" color="#C2410C" />
            <StatBadge n={subtaskCount} text={countLabel(t, "card.subtaskOne", "card.subtaskOther", subtaskCount)} bg="#F1F5F9" color="#475569" />
            <StatBadge n={summary.resources.length} text={countLabel(t, "card.resourceOne", "card.resourceOther", summary.resources.length)} bg="#E7F6F1" color="#0F766E" />
          </div>
        )}
      </Link>
    </div>
  );
}

// Picks the singular/plural key for a count and interpolates {n}. The badge
// renders the number in bold, so we strip the leading "{n} " the key produces.
function countLabel(t: (k: TranslationKey, p?: { n: number }) => string, one: TranslationKey, other: TranslationKey, n: number): string {
  const full = t(n === 1 ? one : other, { n });
  return full.replace(/^\s*\d+\s*/, "");
}

function StatBadge({ n, text, bg, color }: { n: number; text: string; bg: string; color: string }) {
  return (
    <span className="mono inline-block rounded px-1.5 py-0.5 text-[10px]" style={{ background: bg, color }}>
      <span style={{ fontWeight: 700 }}>{n}</span> {text}
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
