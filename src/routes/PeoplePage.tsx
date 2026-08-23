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
import { subscribeWorkspaceMembers, subscribeWorkspace, updateResourceRoles } from "@/services/firestore/workspaces";
import { MasterResourceDialog } from "@/components/people/MasterResourceDialog";
import type { MasterResource, Team, WorkspaceMember, Workspace } from "@/types";
import { colorForName } from "@/domain/constants";

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
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [teamQuery, setTeamQuery] = useState("");
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

  // Members carry the denormalized avatar, because nobody can read anyone else's
  // user document. A linked person therefore shows a real face rather than
  // initials — which is also the clearest signal that the link resolved.
  useEffect(() => {
    if (!workspaceId) return;
    return subscribeWorkspaceMembers(workspaceId, setMembers);
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeWorkspace(workspaceId, setWorkspace);
  }, [workspaceId]);

  const roles = useMemo(() => workspace?.resourceRoles ?? [], [workspace]);

  // Renaming a role rewrites it on everyone who had it. A rename that leaves the
  // old string behind is a fork, not a rename — the same cascade a Pulse already
  // does for its own types.
  const renameRole = (role: string) => {
    const next = window.prompt(t("people.renameRolePrompt"), role)?.trim();
    if (!next || next === role || roles.includes(next)) return;
    run(updateResourceRoles(workspaceId, roles.map((x) => (x === role ? next : x))), "rename role");
    for (const r of rows ?? []) if (r.type === role) run(patchMasterResource(workspaceId, r.id, { type: next }), "rename role");
  };

  const addRole = () => {
    const name = window.prompt(t("people.addRolePrompt"))?.trim();
    if (!name || roles.includes(name)) return;
    run(updateResourceRoles(workspaceId, [...roles, name]), "add role");
  };

  // Removing a role leaves it on the people who have it, exactly as the Pulse's
  // type list does: the label stops being offered, and nobody's record is
  // rewritten behind their back.
  const removeRole = (role: string) => run(updateResourceRoles(workspaceId, roles.filter((x) => x !== role)), "remove role");

  const photoByUid = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of members) if (w.uid && w.photoURL) m.set(w.uid, w.photoURL);
    return m;
  }, [members]);

  const tq = teamQuery.trim().toLowerCase();
  const visibleTeams = useMemo(
    () => (teams ?? []).filter((x) => !tq || (x.name ?? "").toLowerCase().includes(tq)),
    [teams, tq],
  );

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (rows ?? []).filter((r) =>
      !q
      || (r.name ?? "").toLowerCase().includes(q)
      || (r.type ?? "").toLowerCase().includes(q)
      || (r.linkedEmail ?? "").toLowerCase().includes(q)),
    [rows, q],
  );

  // Every write on this page reports its failure. They were fire-and-forget
  // (`void promise`), which is the exact shape that makes a refused write look
  // like a broken UI: nothing changes, nothing says why, and the bug reads as
  // "the badge didn't update". Same lesson as the swallowed onSnapshot error in
  // CLAUDE.md — a write that fails is a fault, not a no-op.
  const [actionError, setActionError] = useState<string | null>(null);
  const run = (p: Promise<unknown>, what: string) => {
    setActionError(null);
    void p.catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      // Console too: the message reaches the customer, the stack reaches us.
      console.error(`[People] ${what} failed`, err);
      setActionError(msg);
    });
  };

  const assign = (resourceId: string, teamId: string, member: boolean) => {
    if (!canManage) return;
    run(setTeamMembership(workspaceId, resourceId, teamId, member), member ? "assign" : "unassign");
  };

  const removeTeam = async (team: Team, e: { clientX: number; clientY: number }) => {
    const ok = await confirmAt(e, {
      message: t("people.deleteTeamConfirm", { name: team.name }),
      // The fear this answers: deleting a group should not delete its people.
      detail: t("people.deleteTeamDetail"),
      confirmLabel: t("people.deleteTeamAction"),
    });
    if (ok) run(deleteTeam(workspaceId, team.id), "delete team");
  };

  const removePerson = async (r: MasterResource, e: { clientX: number; clientY: number }) => {
    const ok = await confirmAt(e, {
      message: t("roster.deleteConfirm", { name: r.name }),
      detail: t("roster.deleteDetail"),
      confirmLabel: t("roster.deleteAction"),
    });
    if (ok) run(deleteMasterResource(workspaceId, r.id), "delete person");
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

        {actionError && (
          <div className="mt-4 flex items-start gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: "#FDECEA", border: "1px solid #F3C7C1", color: "#8C2F22" }}>
            <Icon name="info" size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span className="min-w-0 flex-1">{t("people.writeError")}<span className="mono block opacity-70">{actionError}</span></span>
            <button onClick={() => setActionError(null)} aria-label={t("common.close")} style={{ color: "#8C2F22" }}><Icon name="close" size={13} /></button>
          </div>
        )}

        {/* ---- teams ---------------------------------------------------- */}
        <SectionHead
          title={t("people.teams")}
          count={teams?.length}
          searchValue={teamQuery}
          onSearch={setTeamQuery}
          searchPlaceholder={t("people.searchTeamsPlaceholder")}
          addLabel={t("people.addTeam")}
          addIcon="group"
          onAdd={canManage && !addingTeam ? () => setAddingTeam(true) : undefined}
        />

        {addingTeam && (
          <div className="mb-3 flex items-center gap-2">
            <input
              autoFocus
              value={teamDraft}
              onChange={(e) => setTeamDraft(e.target.value)}
              placeholder={t("people.teamNamePlaceholder")}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && teamDraft.trim()) {
                  run(createTeam(workspaceId, teamDraft, (teams ?? []).map((x) => x.color)), "create team");
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
                run(createTeam(workspaceId, teamDraft, (teams ?? []).map((x) => x.color)), "create team");
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

        {teams && teams.length > 0 && visibleTeams.length === 0 ? (
          <p className="mb-10 rounded-xl border border-dashed px-4 py-6 text-center text-xs" style={{ borderColor: "#E2DFD9", color: "#94A3B8" }}>
            {t("people.noTeamMatch", { query: teamQuery.trim() })}
          </p>
        ) : visibleTeams.length > 0 ? (
          <div className="mb-10 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {visibleTeams.map((team) => {
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
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== team.name) run(renameTeam(workspaceId, team.id, v), "rename team"); }}
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

                  <div className="mt-2 flex flex-col items-start gap-1">
                    {members.length === 0 ? (
                      <span className="text-[11px]" style={{ color: "#CBD5E1" }}>{t("people.dropHere")}</span>
                    ) : (
                      members.map((m) => (
                        // Avatar + NAME. The avatar already falls back to
                        // initials when there is no photo, so pairing it with an
                        // initials label printed the same two letters twice and
                        // told you nothing about who the person is.
                        <span
                          key={m.id}
                          className="flex max-w-full items-center gap-1.5 rounded px-1.5 py-1 text-[11px]"
                          style={{ background: "#F4F5F7", color: "#334155" }}
                          title={m.name}
                        >
                          <PersonAvatar r={m} photo={m.linkedUid ? photoByUid.get(m.linkedUid) : undefined} size={16} />
                          <span className="min-w-0 truncate">{m.name}</span>
                          {canManage && (
                            // The keyboard/touch path for unassigning. Dragging
                            // a chip out would be the only way otherwise, and
                            // drag has neither.
                            <button
                              onClick={() => assign(m.id, team.id, false)}
                              aria-label={t("people.unassign", { name: m.name, team: team.name })}
                              title={t("people.unassign", { name: m.name, team: team.name })}
                              className="shrink-0"
                              style={{ color: "#94A3B8" }}
                            >
                              <Icon name="close" size={11} />
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
          <p className="mb-10 rounded-xl border border-dashed px-4 py-6 text-center text-xs" style={{ borderColor: "#E2DFD9", color: "#94A3B8" }}>
            {t("people.noTeams")}
          </p>
        )}

        {/* ---- people ---------------------------------------------------- */}
        {/* A rule between the two, so "which section am I in" is answered by
            the layout rather than by reading the headings. */}
        <div className="mb-8 border-t" style={{ borderColor: "#E2DFD9" }} />

        {canManage && (
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <span className="mono text-[10px] uppercase tracking-wide" style={{ color: "#94A3B8" }}>{t("people.roles")}</span>
            {roles.map((role) => (
              <span key={role} className="mono flex items-center gap-1 rounded px-2 py-0.5 text-[10px]" style={{ background: "#F4F5F7", color: "#475569" }}>
                <button onClick={() => renameRole(role)} title={t("people.renameRole")}>{role}</button>
                <button onClick={() => removeRole(role)} aria-label={t("people.removeRole", { role })} title={t("people.removeRole", { role })} style={{ color: "#94A3B8" }}>
                  <Icon name="close" size={10} />
                </button>
              </span>
            ))}
            <button onClick={addRole} className="hoverable mono rounded border px-2 py-0.5 text-[10px] font-semibold border-yasdu-orange-soft bg-yasdu-accent text-yasdu-primary">
              + {t("people.addRole")}
            </button>
            {roles.length === 0 && <span className="text-[10px]" style={{ color: "#CBD5E1" }}>{t("people.noRoles")}</span>}
          </div>
        )}

        <SectionHead
          title={t("roster.title")}
          count={rows?.length}
          searchValue={query}
          onSearch={setQuery}
          searchPlaceholder={t("people.searchPlaceholder")}
          addLabel={t("roster.add")}
          addIcon="person_add"
          onAdd={canManage ? () => setEditing("new") : undefined}
        />

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
                photo={r.linkedUid ? photoByUid.get(r.linkedUid) : undefined}
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
          roles={roles}
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
function PersonCard({ r, teams, canManage, photo, dragging, onDragStart, onDragEnd, onEdit, onRemove, onToggleTeam }: {
  r: MasterResource;
  teams: Team[];
  canManage: boolean;
  photo?: string;
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
        <PersonAvatar r={r} photo={photo} size={28} />
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

/**
 * A section's own heading, search and add button.
 *
 * Shared so the two sections cannot drift into looking like different features —
 * they are the same kind of thing (a list you search and add to), and the only
 * differences that should be visible are the words and the icon.
 */
function SectionHead({ title, count, searchValue, onSearch, searchPlaceholder, addLabel, addIcon, onAdd }: {
  title: string;
  count?: number;
  searchValue: string;
  onSearch: (v: string) => void;
  searchPlaceholder: string;
  addLabel: string;
  addIcon: string;
  onAdd?: () => void;
}) {
  const t = useT();
  return (
    <div className="mb-3">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-display text-sm font-semibold text-yasdu-fg">{title}</h2>
        {count !== undefined && <span className="mono text-xs" style={{ color: "#94A3B8" }}>{count}</span>}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative order-1 w-full sm:flex-1 sm:max-w-[420px]">
          <Icon name="search" size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", pointerEvents: "none" }} />
          <input
            value={searchValue}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border text-sm"
            style={{ borderColor: "#E2DFD9", background: "#FFFFFF", color: "#1F2330", padding: "11px 36px", outline: "none" }}
          />
          {searchValue && (
            <button onClick={() => onSearch("")} aria-label={t("dashboard.clearSearch")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }}>
              <Icon name="close" size={15} />
            </button>
          )}
        </div>
        {onAdd && (
          <button
            onClick={onAdd}
            className="hoverable order-2 flex items-center gap-1.5 self-end rounded-lg px-3.5 py-2 text-sm font-semibold text-yasdu-primary-fg sm:ml-auto sm:self-auto"
            style={{ background: "#D85A28" }}
          >
            <Icon name={addIcon} size={16} />
            {addLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A person's avatar: their account picture when the link has resolved and they
 * have one, otherwise initials.
 *
 * The photo is the clearest possible signal that a link is live — a real face
 * says "this is a person with an account here" more immediately than a chip
 * does. It falls back rather than requiring one, because plenty of accounts have
 * no picture and a linked person with no photo is still linked.
 */
function PersonAvatar({ r, photo, size }: { r: MasterResource; photo?: string; size: number }) {
  const label = r.name || r.initials || "?";
  const base: React.CSSProperties = { width: size, height: size, borderRadius: "50%", flexShrink: 0 };
  if (photo) {
    return <img src={photo} alt={label} title={label} style={{ ...base, objectFit: "cover", display: "block" }} />;
  }
  return (
    <span
      className="mono flex items-center justify-center font-bold"
      title={label}
      style={{ ...base, background: colorForName(r.id), color: "#fff", fontSize: Math.max(8, Math.round(size * 0.38)) }}
    >
      {r.initials || initialsOf(r.name)}
    </span>
  );
}
