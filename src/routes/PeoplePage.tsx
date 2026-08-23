import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@/components/shared/Icon";
import { Spinner } from "@/components/shared/Spinner";
import { PulseLockup } from "@/components/shared/Logo";
import { confirmAt } from "@/stores/confirmStore";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/i18n";
import { subscribeRoster, createMasterResource, patchMasterResource, deleteMasterResource, initialsOf } from "@/services/firestore/roster";
import { subscribeTeams, createTeam, renameTeam, deleteTeam, setTeamMembership } from "@/services/firestore/teams";
import { MasterResourceDialog } from "@/components/people/MasterResourceDialog";
import type { MasterResource, Team } from "@/types";

/**
 * People — the workspace roster and its teams (Resource-Master-Spec §1, RM4).
 *
 * Its own screen rather than a dashboard section: this is where an org's people
 * are curated, which is a different job from looking at Pulses, and it needs the
 * room for teams.
 *
 * Assignment is drag-and-drop **plus** buttons. Drag alone is unreachable on
 * touch and unusable with a keyboard, so every drag here has a click that does
 * the same thing — the rule this codebase already applies to hover.
 */
export function PeoplePage() {
  const t = useT();
  const { firebaseUser, userDoc } = useAuthStore();
  const uid = firebaseUser?.uid ?? "";
  const workspaceId = userDoc?.personalWorkspaceId ?? "";
  const canManage = workspaceId === `personal-${uid}`;

  const [rows, setRows] = useState<MasterResource[] | null>(null);
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<MasterResource | "new" | null>(null);
  const [addingTeam, setAddingTeam] = useState(false);
  const [teamDraft, setTeamDraft] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTeam, setDropTeam] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeRoster(workspaceId, (r) => { setRows(r); setError(null); }, setError);
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeTeams(workspaceId, setTeams);
  }, [workspaceId]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (rows ?? []).filter((r) =>
      !q
      || (r.name ?? "").toLowerCase().includes(q)
      || (r.type ?? "").toLowerCase().includes(q)
      || (r.linkedEmail ?? "").toLowerCase().includes(q)),
    [rows, q],
  );

  const assign = (resourceId: string, teamId: string, member: boolean) => {
    if (!canManage) return;
    void setTeamMembership(workspaceId, resourceId, teamId, member);
  };

  const removeTeam = async (team: Team, e: { clientX: number; clientY: number }) => {
    const ok = await confirmAt(e, {
      message: t("people.deleteTeamConfirm", { name: team.name }),
      // The fear this answers: deleting a group should not delete its people.
      detail: t("people.deleteTeamDetail"),
      confirmLabel: t("people.deleteTeamAction"),
    });
    if (ok) void deleteTeam(workspaceId, team.id);
  };

  const removePerson = async (r: MasterResource, e: { clientX: number; clientY: number }) => {
    const ok = await confirmAt(e, {
      message: t("roster.deleteConfirm", { name: r.name }),
      detail: t("roster.deleteDetail"),
      confirmLabel: t("roster.deleteAction"),
    });
    if (ok) void deleteMasterResource(workspaceId, r.id);
  };

  return (
    <div className="min-h-screen bg-yasdu-bg">
      <header className="flex items-center gap-3 border-b px-6 py-3" style={{ borderColor: "#E2DFD9", background: "#FFFFFF" }}>
        <Link to="/" className="hoverable flex items-center gap-1 rounded px-1.5 py-1 text-sm" style={{ color: "#123359" }}>
          <Icon name="chevron_left" size={20} />
          {t("people.backToDashboard")}
        </Link>
        <span className="ml-auto"><PulseLockup variant="light" size={18} /></span>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="font-display text-lg font-semibold text-yasdu-fg">{t("roster.title")}</h1>
        <p className="mt-1 text-xs" style={{ color: "#94A3B8" }}>{t("people.intro")}</p>

        <div className="mt-6 mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative order-1 w-full sm:flex-1 sm:max-w-[420px]">
            <Icon name="search" size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", pointerEvents: "none" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("people.searchPlaceholder")}
              className="w-full rounded-lg border text-sm"
              style={{ borderColor: "#E2DFD9", background: "#FFFFFF", color: "#1F2330", padding: "11px 36px", outline: "none" }}
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label={t("dashboard.clearSearch")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }}>
                <Icon name="close" size={15} />
              </button>
            )}
          </div>
          {canManage && (
            <button
              onClick={() => setEditing("new")}
              className="hoverable order-2 flex items-center gap-1.5 self-end rounded-lg px-3.5 py-2 text-sm font-semibold text-yasdu-primary-fg sm:ml-auto sm:self-auto"
              style={{ background: "#D85A28" }}
            >
              <Icon name="person_add" size={16} />
              {t("roster.add")}
            </button>
          )}
        </div>

        {/* ---- teams ---------------------------------------------------- */}
        <div className="mb-3 flex items-center gap-2">
          <h2 className="font-display text-sm font-semibold text-yasdu-fg">{t("people.teams")}</h2>
          {teams && <span className="mono text-xs" style={{ color: "#94A3B8" }}>{teams.length}</span>}
          {canManage && !addingTeam && (
            <button onClick={() => setAddingTeam(true)} className="hoverable mono ml-auto flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold border-yasdu-orange-soft bg-yasdu-accent text-yasdu-primary">
              <Icon name="add" size={14} />
              {t("people.addTeam")}
            </button>
          )}
        </div>

        {addingTeam && (
          <div className="mb-3 flex items-center gap-2">
            <input
              autoFocus
              value={teamDraft}
              onChange={(e) => setTeamDraft(e.target.value)}
              placeholder={t("people.teamNamePlaceholder")}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && teamDraft.trim()) {
                  await createTeam(workspaceId, teamDraft, (teams ?? []).map((x) => x.color));
                  setTeamDraft(""); setAddingTeam(false);
                }
                if (e.key === "Escape") { setTeamDraft(""); setAddingTeam(false); }
              }}
              className="w-full max-w-xs rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ borderColor: "#E2DFD9" }}
            />
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={async () => {
                if (!teamDraft.trim()) return;
                await createTeam(workspaceId, teamDraft, (teams ?? []).map((x) => x.color));
                setTeamDraft(""); setAddingTeam(false);
              }}
              disabled={!teamDraft.trim()}
              aria-label={t("people.addTeam")}
              className="hoverable rounded-lg border p-2 disabled:opacity-35"
              style={{ borderColor: "#E2DFD9", color: "#D85A28" }}
            >
              <Icon name="check" size={15} />
            </button>
          </div>
        )}

        {teams && teams.length > 0 ? (
          <div className="mb-8 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {teams.map((team) => {
              const members = (rows ?? []).filter((r) => (r.teamIds ?? []).includes(team.id));
              const over = dropTeam === team.id;
              return (
                <div
                  key={team.id}
                  onDragOver={(e) => { if (dragId) { e.preventDefault(); setDropTeam(team.id); } }}
                  onDragLeave={() => setDropTeam((cur) => (cur === team.id ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain") || dragId;
                    if (id) assign(id, team.id, true);
                    setDropTeam(null); setDragId(null);
                  }}
                  className="rounded-xl border p-3"
                  style={{
                    borderColor: over ? team.color : "#E2DFD9",
                    background: over ? "#FFFDF9" : "#FFFFFF",
                    boxShadow: over ? `0 0 0 2px ${team.color}33` : undefined,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: team.color, flexShrink: 0 }} />
                    <input
                      defaultValue={team.name}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== team.name) void renameTeam(workspaceId, team.id, v); }}
                      readOnly={!canManage}
                      className="min-w-0 flex-1 bg-transparent text-xs font-semibold outline-none"
                      style={{ color: "#1F2330" }}
                    />
                    <span className="mono text-[10px]" style={{ color: "#94A3B8" }}>{members.length}</span>
                    {canManage && (
                      <button onClick={(e) => void removeTeam(team, e)} title={t("people.deleteTeamAction")} aria-label={t("people.deleteTeamAction")} className="hoverable rounded p-0.5" style={{ color: "#94A3B8" }}>
                        <Icon name="close" size={13} />
                      </button>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1">
                    {members.length === 0 ? (
                      <span className="text-[11px]" style={{ color: "#CBD5E1" }}>{t("people.dropHere")}</span>
                    ) : (
                      members.map((m) => (
                        <span key={m.id} className="mono flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]" style={{ background: "#F4F5F7", color: "#475569" }}>
                          {m.initials || initialsOf(m.name)}
                          {canManage && (
                            // The keyboard/touch path for unassigning. Dragging
                            // a chip out would be the only way otherwise, and
                            // drag has neither.
                            <button onClick={() => assign(m.id, team.id, false)} aria-label={t("people.unassign", { name: m.name, team: team.name })} title={t("people.unassign", { name: m.name, team: team.name })} style={{ color: "#94A3B8" }}>
                              <Icon name="close" size={10} />
                            </button>
                          )}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mb-8 rounded-xl border border-dashed px-4 py-6 text-center text-xs" style={{ borderColor: "#E2DFD9", color: "#94A3B8" }}>
            {t("people.noTeams")}
          </p>
        )}

        {/* ---- people ---------------------------------------------------- */}
        <h2 className="font-display mb-3 text-sm font-semibold text-yasdu-fg">{t("roster.title")}</h2>

        {error ? (
          <p className="rounded-lg px-3 py-2 text-xs" style={{ background: "#FDECEA", border: "1px solid #F3C7C1", color: "#8C2F22" }}>{t("roster.loadError")}</p>
        ) : rows === null ? (
          <Spinner size={20} label={t("common.loading")} className="py-8" />
        ) : matches.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-xs" style={{ borderColor: "#E2DFD9", color: "#94A3B8" }}>
            {q ? t("people.noMatch", { query: query.trim() }) : t("roster.empty")}
          </p>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {matches.map((r) => (
              <PersonCard
                key={r.id}
                r={r}
                teams={teams ?? []}
                canManage={canManage}
                dragging={dragId === r.id}
                onDragStart={(e) => { e.dataTransfer.setData("text/plain", r.id); setDragId(r.id); }}
                onDragEnd={() => { setDragId(null); setDropTeam(null); }}
                onEdit={() => setEditing(r)}
                onRemove={removePerson}
                onToggleTeam={(teamId, member) => assign(r.id, teamId, member)}
              />
            ))}
          </div>
        )}
      </main>

      {editing && (
        <MasterResourceDialog
          resource={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            if (editing === "new") await createMasterResource(workspaceId, values);
            else await patchMasterResource(workspaceId, editing.id, values);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/** One person. Draggable onto a team card, and equipped with a menu that does
 * the same thing without a mouse. */
function PersonCard({ r, teams, canManage, dragging, onDragStart, onDragEnd, onEdit, onRemove, onToggleTeam }: {
  r: MasterResource;
  teams: Team[];
  canManage: boolean;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onEdit: () => void;
  onRemove: (r: MasterResource, e: { clientX: number; clientY: number }) => void;
  onToggleTeam: (teamId: string, member: boolean) => void;
}) {
  const t = useT();
  const live = !!r.linkedUid;
  const waiting = !live && !!r.linkedEmail;
  const mine = new Set(r.teamIds ?? []);

  return (
    <div
      draggable={canManage}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="rounded-xl border p-3"
      style={{ borderColor: "#E2DFD9", background: "#FFFFFF", opacity: dragging ? 0.45 : 1, cursor: canManage ? "grab" : "default" }}
    >
      <div className="flex items-center gap-2">
        <span className="mono flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold" style={{ width: 28, height: 28, background: "#F1F5F9", color: "#475569" }}>
          {r.initials || initialsOf(r.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold" style={{ color: "#1F2330" }}>{r.name}</div>
          <div className="mono truncate text-[10px]" style={{ color: "#94A3B8" }}>
            {[r.type, `${r.capacity ?? 100}%`].filter(Boolean).join(" · ")}
          </div>
        </div>
        <span
          className="mono shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase"
          title={live ? t("roster.linkedTitle") : waiting ? t("roster.waitingTitle") : t("roster.unlinkedTitle")}
          style={live ? { background: "#E7F6F1", color: "#0F766E" } : waiting ? { background: "#FEF3C7", color: "#92400E" } : { background: "#F4F5F7", color: "#94A3B8" }}
        >
          {live ? t("roster.linked") : waiting ? t("roster.waiting") : t("roster.unlinked")}
        </span>
      </div>

      {r.linkedEmail && <div className="mono mt-1 truncate text-[10px]" style={{ color: "#94A3B8" }}>{r.linkedEmail}</div>}

      {canManage && teams.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {teams.map((tm) => {
            const on = mine.has(tm.id);
            return (
              <button
                key={tm.id}
                onClick={() => onToggleTeam(tm.id, !on)}
                title={on ? t("people.unassign", { name: r.name, team: tm.name }) : t("people.assign", { name: r.name, team: tm.name })}
                className="hoverable mono rounded px-1.5 py-0.5 text-[9px]"
                style={on
                  ? { background: tm.color, color: "#FFFFFF" }
                  : { background: "#F8FAFC", color: "#94A3B8", border: "1px solid #E2DFD9" }}
              >
                {tm.name}
              </button>
            );
          })}
        </div>
      )}

      {canManage && (
        <div className="mt-2 flex justify-end gap-1">
          <button onClick={onEdit} title={t("common.edit")} aria-label={t("common.edit")} className="hoverable rounded border p-1" style={{ borderColor: "#E2DFD9", color: "#64748B" }}>
            <Icon name="edit" size={13} />
          </button>
          <button onClick={(e) => void onRemove(r, e)} title={t("roster.deleteAction")} aria-label={t("roster.deleteAction")} className="hoverable rounded border p-1" style={{ borderColor: "#E2DFD9", color: "#94A3B8" }}>
            <Icon name="delete" size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
