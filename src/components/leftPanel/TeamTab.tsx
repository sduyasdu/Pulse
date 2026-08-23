import { useMemo, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { emailKey } from "@/services/firestore/emailKey";
import { AddFromRosterDialog } from "./AddFromRosterDialog";
import { ResourceOriginBadge, ORIGIN_ORANGE } from "@/components/shared/ResourceOriginBadge";
import { usePulseStore } from "@/stores/pulseStore";
import { useAuthStore } from "@/stores/authStore";
import { allocInRange } from "@/domain/assignments";
import { todayIndex } from "@/domain/dateUtils";
import { clamp } from "@/domain/constants";
import { ResourceBadge } from "@/components/shared/ResourceBadge";
import { confirmAt } from "@/stores/confirmStore";
import { useT } from "@/i18n";

interface TeamTabProps {
  canEdit: boolean;
  filterResource: string | null;
  setFilterResource: (id: string | null) => void;
}

/** One look for both add buttons — same padding, same icon size, same colour. */
const ADD_BTN = "hoverable mono text-xs flex items-center gap-1 px-2 py-0.5 rounded";
const ADD_BTN_STYLE = ORIGIN_ORANGE;

export function TeamTab({ canEdit, filterResource, setFilterResource }: TeamTabProps) {
  const t = useT();
  const resources = usePulseStore((s) => s.resources);
  const features = usePulseStore((s) => s.features);
  const members = usePulseStore((s) => s.members);
  const myUid = useAuthStore((s) => s.firebaseUser?.uid);
  const myEmail = useAuthStore((s) => s.firebaseUser?.email ?? "");
  const addResource = usePulseStore((s) => s.addResource);
  const removeResource = usePulseStore((s) => s.removeResource);
  const duplicateResource = usePulseStore((s) => s.duplicateResource);
  const patchResource = usePulseStore((s) => s.patchResource);
  const [query, setQuery] = useState("");
  const pulse = usePulseStore((s) => s.pulse);
  const [adding, setAdding] = useState(false);
  const [picking, setPicking] = useState(false);
  // Controlled, so the confirm button can read the value and be disabled while
  // it is empty. The field used to be uncontrolled and read `e.target.value`,
  // which only a keystroke could reach.
  const [draft, setDraft] = useState("");
  // Pending link that would attach an account already linked to other
  // resource(s) — resolved by the Cancel / Keep both / Replace dialog.
  const [linkConflict, setLinkConflict] = useState<{ resourceId: string; email: string; conflicts: { id: string; label: string }[] } | null>(null);

  /** One path for both Enter and the check button, so they cannot diverge. */
  const commitResource = () => {
    const name = draft.trim();
    if (!name) return;
    void addResource(name, null);
    setDraft("");
    setAdding(false);
  };

  // The client writes the EMAIL; a trigger resolves the uid against this Pulse's
  // membership (Resource-Master-Spec RM6/RM16). Writing the uid here would be
  // refused by the rules, and would also be a lie waiting to happen — the uid
  // means "collaborator on this Pulse", which is a fact about membership, not
  // about what someone picked in a dropdown.
  //
  // Unlinking clears BOTH: an explicit unlink is a statement about who this
  // resource is, unlike a membership change, which clears only the resolution
  // (RM17, SF7).
  const onLinkChange = (resourceId: string, value: string) => {
    const email = value ? emailKey(value) : null;
    if (!email) {
      void patchResource(resourceId, { linkedEmail: null, linkedUid: null });
      return;
    }
    const conflicts = resources.filter((x) => x.id !== resourceId && x.linkedEmail && emailKey(x.linkedEmail) === email);
    if (conflicts.length === 0) {
      void patchResource(resourceId, { linkedEmail: email });
      return;
    }
    setLinkConflict({ resourceId, email, conflicts: conflicts.map((c) => ({ id: c.id, label: c.name?.trim() || c.initials })) });
  };

  const q = query.trim().toLowerCase();
  // Four axes, because they answer different questions: the name, the Pulse's
  // own `type`, the inherited org `role` (RM24), and the email — often the only
  // thing someone remembers about a colleague.
  const filtered = resources.filter((r) => !q
    || r.name.toLowerCase().includes(q)
    || (r.type || "").toLowerCase().includes(q)
    || (r.role || "").toLowerCase().includes(q)
    || (r.linkedEmail || "").toLowerCase().includes(q));

  // Three forward 4-week windows from today, for the per-resource load
  // indicators (avg allocation over the window ÷ the person's capacity).
  const today = todayIndex();
  const LOAD_WINDOWS = [
    { label: "1–4w", lo: today, hi: today + 28 },
    { label: "5–8w", lo: today + 28, hi: today + 56 },
    { label: "9–12w", lo: today + 56, hi: today + 84 },
  ];

  // `masterId` is present only on resources copied from the roster, so this is
  // exactly the set the picker should show as already added.
  const linkedMasterIds = useMemo(
    () => new Set(resources.map((r) => r.masterId).filter((x): x is string => !!x)),
    [resources],
  );

  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 rounded px-2 py-1.5" style={{ border: "1px solid #E2DFD9", background: "#FDFCF8" }}>
        <Icon name="search" size={13} style={{ color: "#64748B" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("team.filterPlaceholder")}
          className="bg-transparent text-xs flex-1"
          style={{ color: "#1F2330", outline: "none", minWidth: 0 }}
        />
        {query && (
          <button onClick={() => setQuery("")}>
            <Icon name="close" size={12} style={{ color: "#64748B" }} />
          </button>
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="mono text-xs" style={{ color: "#64748B" }}>{t("team.peopleCount", { n: filtered.length })}</span>
        {/* Both add buttons share one class and one icon size, so they read as a
            pair of equal choices rather than a button and an afterthought. */}
        {canEdit && (
          <button onClick={() => setAdding(true)} className={ADD_BTN} style={ADD_BTN_STYLE} title={t("team.addNew")}>
            <Icon name="person_add" size={12} />
            {t("team.add")}
          </button>
        )}
        {/* Only offered when this Pulse belongs to a workspace — the roster is a
            property of the org, and there is nothing to pull from without one. */}
        {canEdit && pulse?.workspaceId && (
          <button onClick={() => setPicking(true)} className={ADD_BTN} style={ADD_BTN_STYLE} title={t("team.addFromRoster")}>
            <Icon name="group" size={12} />
            {t("team.addFrom")}
          </button>
        )}
      </div>
      {adding && (
        // Input and confirm button share one bordered box so they read as a
        // single field rather than a field with a stray button beside it.
        <div className="flex w-full items-center rounded" style={{ border: "1px solid #E2DFD9", background: "#FFFFFF" }}>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("team.addPlaceholder")}
            className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-xs outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter") commitResource();
              if (e.key === "Escape") { setDraft(""); setAdding(false); }
            }}
            onBlur={() => { setDraft(""); setAdding(false); }}
          />
          <button
            // Without this the button never fires: clicking it blurs the input,
            // onBlur tears the whole row down, and the click lands on nothing.
            // preventDefault on mousedown stops the blur from happening at all.
            onMouseDown={(e) => e.preventDefault()}
            onClick={commitResource}
            disabled={draft.trim() === ""}
            title={t("team.addConfirm")}
            aria-label={t("team.addConfirm")}
            className="hoverable flex shrink-0 items-center justify-center px-2 py-1.5 disabled:opacity-35"
            style={{ color: "#D85A28" }}
          >
            <Icon name="check" size={14} />
          </button>
        </div>
      )}
      {filterResource && (
        <button onClick={() => setFilterResource(null)} className="w-full flex items-center justify-between px-2 py-1.5 rounded" style={{ background: "#F7E8DA", border: "1px solid #F0A875" }}>
          <span className="mono text-xs" style={{ color: "#D85A28" }}>
            {t("team.filteringBy", { name: resources.find((x) => x.id === filterResource)?.name ?? filterResource })}
          </span>
          <span className="mono text-xs" style={{ color: "#D85A28", display: "inline-flex", alignItems: "center", gap: 3 }}>{t("team.clear")} <Icon name="close" size={11} /></span>
        </button>
      )}
      {filtered.map((r) => {
        const active = filterResource === r.id;
        const loadPct = (lo: number, hi: number) => clamp(Math.round((allocInRange(features, r.id, lo, hi) / (r.capacity || 100)) * 100), 0, 999);
        return (
          <div
            key={r.id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)}
            onClick={() => setFilterResource(active ? null : r.id)}
            className="rounded px-2.5 py-2 cursor-pointer"
            title={t("team.dragToAssign")}
            style={{ background: active ? "#FFF7F1" : "#FFFFFF", border: active ? "1px solid #EE7240" : "1px solid #E2DFD9" }}
          >
            <div className="flex items-center gap-2">
              <ResourceBadge
                resourceId={r.id}
                size={22}
                // RM20's three states, read straight off the two fields: no
                // email is a placeholder, email+uid is a live collaborator,
                // email alone is rostered but waiting for access here.
                ring={r.linkedUid ? "#12A594" : r.linkedEmail ? "#EAB308" : undefined}
                title={r.linkedUid ? t("team.linkedAccount") : r.linkedEmail ? t("team.linkedWaiting") : t("team.freeform")}
              />
              <div className="overflow-hidden flex-1">
                <div className="flex items-center gap-1">
                  <ResourceOriginBadge masterId={r.masterId} />
                  <div className="text-xs font-medium truncate" style={{ color: "#1F2330" }}>{r.name}</div>
                </div>
                <div className="mono truncate" style={{ fontSize: 10, color: "#64748B" }}>{r.type || "—"} · {t("team.limit", { n: r.capacity })}</div>
              </div>
              {active && <span className="mono text-xs" style={{ color: "#EE7240" }}>●</span>}
              {canEdit && (
                <button
                  title={t("team.duplicateResource")}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    void duplicateResource(r.id);
                  }}
                  className="flex-shrink-0 rounded"
                  style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "#F1F5F9" }}
                >
                  <Icon name="content_copy" size={12} style={{ color: "#64748B" }} />
                </button>
              )}
              {canEdit && (
                <button
                  title={t("team.removeResource")}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (await confirmAt(e, { message: t("team.removeMsg", { name: r.name }), detail: t("team.removeDetail"), confirmLabel: t("common.remove") })) void removeResource(r.id);
                  }}
                  className="flex-shrink-0 rounded"
                  style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "#FDEBEC" }}
                >
                  <Icon name="delete" size={13} style={{ color: "#9F1D23" }} />
                </button>
              )}
            </div>
            <div className="mt-2 flex gap-1.5">
              {LOAD_WINDOWS.map((w) => {
                const load = loadPct(w.lo, w.hi);
                const color = load > 100 ? "#E5484D" : load >= 50 ? "#12A594" : "#F5A524";
                return (
                  <div key={w.label} className="flex-1" title={`${w.label}: ${load}% load`}>
                    <div className="flex items-center justify-between">
                      <span className="mono" style={{ fontSize: 8, color: "#94A3B8" }}>{w.label}</span>
                      <span className="mono" style={{ fontSize: 8, fontWeight: 700, color }}>{load}%</span>
                    </div>
                    <div style={{ height: 4, background: "#F1F5F9", borderRadius: 2, overflow: "hidden", marginTop: 2 }}>
                      <div style={{ height: "100%", width: `${clamp(load, 0, 100)}%`, background: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
            {canEdit && members.length > 0 && (
              <div className="relative mt-1.5">
                <Icon name="link" size={12} style={{ position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", pointerEvents: "none" }} />
                <select
                  value={r.linkedEmail || ""}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onLinkChange(r.id, e.target.value)}
                  className="mono w-full text-[10px] border rounded py-0.5"
                  style={{ borderColor: "#E2DFD9", color: "#64748B", paddingLeft: 22, paddingRight: 4 }}
                  title={t("team.linkTitle")}
                >
                  <option value="">{t("team.notLinked")}</option>
                  {myEmail && <option value={emailKey(myEmail)}>{t("team.myAccount")} ({myEmail})</option>}
                  {members.filter((m) => m.uid !== myUid && m.email).map((m) => (
                    <option key={m.uid} value={emailKey(m.email)}>{m.email}</option>
                  ))}
                  {/* A link copied from the roster can name someone who is not a
                      collaborator here (RM18). The dropdown only OFFERS
                      collaborators, so without this the select would silently
                      show blank and the next change would wipe the link. */}
                  {r.linkedEmail && !members.some((m) => m.email && emailKey(m.email) === emailKey(r.linkedEmail!)) && (
                    <option value={emailKey(r.linkedEmail)}>{r.linkedEmail} — {t("team.notCollaborator")}</option>
                  )}
                </select>
              </div>
            )}
          </div>
        );
      })}

      {picking && pulse?.workspaceId && (
        <AddFromRosterDialog
          pulseId={pulse.id}
          workspaceId={pulse.workspaceId}
          alreadyLinked={linkedMasterIds}
          onClose={() => setPicking(false)}
        />
      )}

      {linkConflict && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 px-4" style={{ zIndex: 300 }} onClick={() => setLinkConflict(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-yasdu-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display mb-2 text-base font-semibold text-yasdu-fg">{t("team.accountLinked")}</h2>
            <p className="text-xs leading-relaxed" style={{ color: "#64748B" }}>
              {t("team.linkConflictBody", { account: linkConflict.email, resources: linkConflict.conflicts.map((c) => `“${c.label}”`).join(", ") })}
              {" "}{linkConflict.conflicts.length === 1 ? t("team.linkConflictOne") : t("team.linkConflictMany")}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setLinkConflict(null)} className="rounded-lg px-3 py-2 text-sm" style={{ color: "#64748B" }}>{t("common.cancel")}</button>
              <button
                onClick={() => { void patchResource(linkConflict.resourceId, { linkedEmail: linkConflict.email }); setLinkConflict(null); }}
                className="rounded-lg px-3 py-2 text-sm font-semibold"
                style={{ background: "#F4F2EC", color: "#334155", border: "1px solid #E2DFD9" }}
              >
                {t("team.keepBoth")}
              </button>
              <button
                onClick={() => { linkConflict.conflicts.forEach((c) => void patchResource(c.id, { linkedEmail: null, linkedUid: null })); void patchResource(linkConflict.resourceId, { linkedEmail: linkConflict.email }); setLinkConflict(null); }}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg"
                style={{ background: "#D85A28" }}
              >
                {t("team.replace")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
