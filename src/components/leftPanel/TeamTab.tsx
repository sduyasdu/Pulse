import { useMemo, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { emailKey } from "@/services/firestore/emailKey";
import { AddFromRosterDialog } from "./AddFromRosterDialog";
import { ResourceOriginBadge } from "@/components/shared/ResourceOriginBadge";
import { usePulseStore } from "@/stores/pulseStore";
import { useAuthStore } from "@/stores/authStore";
import { loadColor, loadPctInWindow, loadWindows } from "@/domain/assignments";
import { todayIndex } from "@/domain/dateUtils";
import { clamp } from "@/domain/constants";
import { canViewPeopleCost } from "@/domain/permissions";
import { COSTS_ENABLED } from "@/domain/flags";
import { ResourceBadge } from "@/components/shared/ResourceBadge";
import { useDebouncedText } from "@/hooks/useDebouncedText";
import { confirmAt } from "@/stores/confirmStore";
import { useT } from "@/i18n";

interface TeamTabProps {
  canEdit: boolean;
  filterResource: string | null;
  setFilterResource: (id: string | null) => void;
}

/**
 * The task-detail form's icon button: a 20px square, a tinted ground, a 13px
 * glyph. Borrowed rather than reinvented so the two panels do not develop
 * separate dialects for the same gesture.
 *
 * These replace three labelled buttons that were competing for a 320px row —
 * "+ add", "from People", and the resource-types disclosure. Their words are
 * now `title`/`aria-label`, which is where the word belongs when the glyph
 * already says it.
 */
const ICON_BTN = "hoverable flex flex-shrink-0 items-center justify-center rounded";
const ICON_BTN_STYLE = { width: 20, height: 20 } as const;
const ICON_NEUTRAL = { ...ICON_BTN_STYLE, background: "#F1F5F9", color: "#64748B" } as const;
const ICON_ACCENT = { ...ICON_BTN_STYLE, background: "#F7E8DA", color: "#D85A28" } as const;
/** The same square, filled, for a disclosure that is currently open — the
 * `PLAN_ON` language the details panel uses for "this toggle is on". */
const ICON_ON = { ...ICON_BTN_STYLE, background: "#EE7240", color: "#0A1428" } as const;

/** Static: there is one Team tab on screen at a time, so a `useId` would buy
 * nothing and cost a hook. */
const TYPES_PANEL_ID = "team-resource-types";

/** Name field for a person, debounced — a rename is a document write, not
 * something to fire per keystroke. Moved here with the rest of the Capacity
 * tab's per-person editors. */
/**
 * The person's name, edited where it is read.
 *
 * It used to be a second field inside the expanded settings, which meant the
 * name appeared twice in one row — once as the heading you scan for and once as
 * a form field two clicks away — and renaming meant opening a panel to change
 * something already on screen. Editing it in place removes both.
 *
 * At rest it is styled as text, not as a field: this is a roster you scan down,
 * and twenty input boxes would read as a form. The affordance arrives on hover
 * (decorative, Tailwind-gated, so it is simply absent on touch — where the
 * field is still reachable by tapping it) and on focus, which is the state that
 * actually matters for knowing you are editing.
 */
function ResourceNameInput({
  name,
  disabled,
  showField,
  onCommit,
  renameTitle,
}: {
  name: string;
  disabled: boolean;
  /** Draw the field chrome without waiting for hover or focus. True while the
   * row's settings are open: that row has declared itself the one being
   * edited, so its name should not be the only thing still pretending to be
   * read-only text. */
  showField?: boolean;
  onCommit: (name: string) => void;
  renameTitle: string;
}) {
  const [local, onChange] = useDebouncedText(name, onCommit);
  const [focused, setFocused] = useState(false);
  const asField = !disabled && (focused || showField);
  return (
    <input
      value={local}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      // The row is a filter toggle and a drag source; neither should fire
      // because someone put a caret in a name.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      title={disabled ? undefined : renameTitle}
      className={"min-w-0 flex-1 truncate rounded px-1 py-0.5 text-xs font-medium" + (disabled ? "" : " hover:bg-[#F1F5F9]")}
      style={{
        color: "#1F2330",
        background: asField ? "#FFFFFF" : "transparent",
        // Orange while the row is open but the caret is elsewhere, matching the
        // border the row itself is wearing; the ordinary field grey once it has
        // focus, so "you are typing here" still reads differently from "this is
        // the row you opened".
        border: "1px solid " + (asField ? (focused ? "#E2DFD9" : "#F0A875") : "transparent"),
        outline: "none",
        cursor: disabled ? "default" : "text",
      }}
    />
  );
}

/** $/h input. Local while typing, committed on blur or Enter. Empty clears the
 * rate, which removes that person's labour rows rather than zeroing them
 * (Costs-Spec §8.8). */
function RateInput({ value, onCommit, title }: { value: number | null; onCommit: (v: number | null) => void; title: string }) {
  const [local, setLocal] = useState(value == null ? "" : String(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? local : value == null ? "" : String(value);
  const commit = () => {
    const n = Number(local);
    onCommit(local.trim() === "" || !Number.isFinite(n) || n <= 0 ? null : n);
  };
  return (
    <div className="flex items-center gap-0.5">
      <span className="mono" style={{ fontSize: 10, color: "#94A3B8" }}>$</span>
      <input
        type="number"
        min="0"
        step="1"
        value={shown}
        title={title}
        placeholder="—"
        onFocus={() => { setLocal(value == null ? "" : String(value)); setFocused(true); }}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="mono rounded border px-1 py-0.5 text-right text-xs"
        style={{ borderColor: "#E2DFD9", width: 58, flexShrink: 0 }}
      />
    </div>
  );
}

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
  const setResourceTypes = usePulseStore((s) => s.setResourceTypes);
  const rates = usePulseStore((s) => s.rates);
  const setRate = usePulseStore((s) => s.setRate);
  const [query, setQuery] = useState("");
  /** Which row has its settings open. One at a time: these rows are already
   * dense, and several open at once turns a scannable roster into a form. */
  const [editing, setEditing] = useState<string | null>(null);
  /** The resource-type editor, behind its own icon button — it is Pulse
   * configuration, not a fact about any one person, and it was taking a
   * permanent slot in a 320px panel to say so. */
  const [typesOpen, setTypesOpen] = useState(false);
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

  // Pay rates are admin-only (Costs-Spec §8.7 / CO15), AND behind the parked
  // costing flag (CO21): the capability is unchanged and still correct, the
  // surface is simply not shown.
  const me = myUid ? members.find((m) => m.uid === myUid) : undefined;
  const seesPeopleCost = COSTS_ENABLED && !!me && canViewPeopleCost(me);
  const rateOf = (rid: string) => rates.find((x) => x.resourceId === rid)?.hourlyCost ?? null;
  const resourceTypes = pulse?.resourceTypes ?? [];

  const addType = () => {
    const n = window.prompt(t("capacity.newTypePrompt"));
    if (n && n.trim() && !resourceTypes.includes(n.trim())) void setResourceTypes([...resourceTypes, n.trim()]);
  };
  const renameType = (type: string) => {
    const nn = window.prompt(t("capacity.renameTypePrompt"), type);
    if (!nn || !nn.trim() || nn.trim() === type) return;
    void setResourceTypes(resourceTypes.map((x) => (x === type ? nn.trim() : x)));
    // Every resource, roster-linked or not: `type` is local to this Pulse now
    // (RM24), so nothing here can be undone by propagation.
    resources.filter((r) => r.type === type).forEach((r) => void patchResource(r.id, { type: nn.trim() }));
  };
  const deleteType = async (type: string, e: { clientX: number; clientY: number }) => {
    if (await confirmAt(e, { message: t("capacity.deleteTypeMsg", { type }), detail: t("capacity.deleteTypeDetail") })) {
      void setResourceTypes(resourceTypes.filter((x) => x !== type));
    }
  };

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

  // From the domain, so the windows and the colour thresholds have one
  // definition. They used to be declared inline here AND in the Capacity tab,
  // character for character.
  const LOAD_WINDOWS = loadWindows(todayIndex());

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
      <div className="flex items-center gap-1.5">
        <span className="mono flex-1 text-xs" style={{ color: "#64748B" }}>{t("team.peopleCount", { n: filtered.length })}</span>
        {canEdit && (
          <button onClick={() => setAdding(true)} className={ICON_BTN} style={ICON_ACCENT} title={t("team.addNew")} aria-label={t("team.addNew")}>
            <Icon name="person_add" size={13} />
          </button>
        )}
        {/* Only offered when this Pulse belongs to a workspace — the roster is a
            property of the org, and there is nothing to pull from without one. */}
        {canEdit && pulse?.workspaceId && (
          <button onClick={() => setPicking(true)} className={ICON_BTN} style={ICON_ACCENT} title={t("team.addFromRoster")} aria-label={t("team.addFromRoster")}>
            <Icon name="group" size={13} />
          </button>
        )}
        {canEdit && (
          <button
            onClick={() => setTypesOpen((o) => !o)}
            aria-expanded={typesOpen}
            aria-controls={TYPES_PANEL_ID}
            className={ICON_BTN}
            style={typesOpen ? ICON_ON : ICON_NEUTRAL}
            title={t("team.manageTypes")}
            aria-label={t("team.manageTypes")}
          >
            <Icon name="sell" size={13} />
          </button>
        )}
      </div>

      {typesOpen && canEdit && (
        <div id={TYPES_PANEL_ID} className="rounded px-3 py-2.5" style={{ border: "1px solid #E2DFD9", background: "#FDFCF8" }}>
          <div className="flex items-center justify-between">
            <span className="mono text-xs" style={{ color: "#64748B" }}>{t("capacity.resourceTypes")}</span>
            <button onClick={addType} className={ICON_BTN} style={ICON_ACCENT} title={t("capacity.add")} aria-label={t("capacity.add")}>
              <Icon name="add" size={13} />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {resourceTypes.map((rt) => (
              <span key={rt} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs" style={{ background: "#F1F5F9", color: "#475569" }}>
                {rt}
                <button onClick={() => renameType(rt)} title={t("capacity.rename")} aria-label={t("capacity.rename")}><Icon name="edit" size={12} style={{ color: "#64748B" }} /></button>
                <button onClick={(e) => void deleteType(rt, e)} title={t("common.delete")} aria-label={t("common.delete")}><Icon name="close" size={12} style={{ color: "#64748B" }} /></button>
              </span>
            ))}
            {resourceTypes.length === 0 && <span className="mono text-xs" style={{ color: "#78859A" }}>{t("capacity.noTypes")}</span>}
          </div>
        </div>
      )}
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
        const open = editing === r.id;
        const rows = features.filter((f) => (f.resources || []).includes(r.id) || (f.children || []).some((c) => (c.resources || []).includes(r.id)));
        return (
          <div
            key={r.id}
            draggable
            onDragStart={(e) => {
              // A `draggable` ancestor swallows text selection inside its
              // fields: press and sweep across the name and the browser starts
              // dragging the row instead of selecting the word. Decline the
              // drag when it begins in an input or a select — the rest of the
              // row is still a drag handle.
              const from = e.target as HTMLElement;
              if (from.closest("input, select, textarea")) {
                e.preventDefault();
                return;
              }
              e.dataTransfer.setData("text/plain", r.id);
            }}
            onClick={() => setFilterResource(active ? null : r.id)}
            className="rounded px-2.5 py-2 cursor-pointer"
            title={t("team.dragToAssign")}
            // Orange means "this row is singled out"; the weight says how
            // strongly. Open settings is the loudest, because it is the state
            // you are working in and the one that made the row grow — and the
            // two can be true at once, so they cannot be the same treatment.
            style={{
              background: open || active ? "#FFF7F1" : "#FFFFFF",
              border: open ? "2px solid #EE7240" : active ? "1px solid #EE7240" : "1px solid #E2DFD9",
            }}
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
                  <ResourceNameInput
                    name={r.name}
                    disabled={!canEdit}
                    showField={open}
                    onCommit={(name) => void patchResource(r.id, { name })}
                    renameTitle={t("capacity.clickToRename")}
                  />
                  <ResourceOriginBadge masterId={r.masterId} />
                </div>
                <div className="mono truncate" style={{ fontSize: 10, color: "#64748B" }}>{r.type || "—"} · {t("team.limit", { n: r.capacity })}</div>
              </div>
              {active && <span className="mono text-xs" style={{ color: "#EE7240" }}>●</span>}
              {rows.length === 0 && <span className="mono flex-shrink-0 rounded px-1.5 py-0.5 text-xs" style={{ background: "#F1F5F9", color: "#64748B" }}>{t("capacity.idle")}</span>}
              {/* Everything the Capacity tab used to own, one row at a time.
                  Shown on demand rather than always: these rows already carry a
                  badge, a name, two actions, a link select and three bars, and
                  a 320px panel cannot also hold a slider, a select and a rate
                  field without becoming a form you have to scroll to read. */}
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setEditing(open ? null : r.id); }}
                aria-expanded={open}
                className={ICON_BTN}
                style={open ? ICON_ON : ICON_NEUTRAL}
                title={t("team.settings")}
                aria-label={t("team.settings")}
              >
                <Icon name="tune" size={13} />
              </button>
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
                const load = loadPctInWindow(features, r, w.lo, w.hi);
                const color = loadColor(load);
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

            {open && (
              // Stops the row's click-to-filter firing while someone drags a
              // slider or picks a type inside it.
              <div
                className="mt-2 flex flex-col gap-2 rounded px-2 py-2"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                style={{ background: "#FDFCF8", border: "1px solid #EEF1F4" }}
              >
                {/* The ORG role, inherited and read-only (RM24) — who this
                    person is, as distinct from how this Pulse files them. */}
                {r.role && (
                  <span
                    className="mono inline-block self-start rounded px-1.5 py-0.5 text-[9px]"
                    title={t("capacity.roleFromRoster")}
                    style={{ background: "#F4F5F7", color: "#64748B" }}
                  >
                    {r.role}
                  </span>
                )}
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>{t("capacity.type")}</span>
                    {/* Always local, always editable — a Pulse groups people its
                        own way, whether or not they came from the roster
                        (RM24). */}
                    <select
                      value={r.type || ""}
                      disabled={!canEdit}
                      onChange={(e) => void patchResource(r.id, { type: e.target.value || null })}
                      className="mono w-full rounded border px-1 py-0.5 text-xs"
                      style={{ borderColor: "#E2DFD9" }}
                    >
                      <option value="">{t("common.none")}</option>
                      {resourceTypes.map((rt) => (
                        <option key={rt} value={rt}>{rt}</option>
                      ))}
                      {r.type && !resourceTypes.includes(r.type) && <option value={r.type}>{r.type}</option>}
                    </select>
                  </div>
                  <div style={{ width: 108 }}>
                    <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>{t("capacity.limitPct")}</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        disabled={!canEdit}
                        value={r.capacity}
                        onChange={(e) => void patchResource(r.id, { capacity: parseInt(e.target.value, 10) })}
                        className="flex-1"
                        style={{ accentColor: "#EE7240", minWidth: 0 }}
                      />
                      <input
                        type="number"
                        min="0"
                        max="100"
                        disabled={!canEdit}
                        value={r.capacity}
                        onChange={(e) => void patchResource(r.id, { capacity: clamp(parseInt(e.target.value || "0", 10), 0, 100) })}
                        className="mono rounded border px-1 py-0.5 text-right text-xs"
                        style={{ borderColor: "#E2DFD9", width: 50, flexShrink: 0 }}
                      />
                    </div>
                  </div>
                </div>
                {/* Hourly cost — admins only (Costs-Spec §8.7). The control
                    simply does not exist for anyone else, and the underlying
                    document is unreadable to them, so hiding it is not the
                    security boundary. */}
                {seesPeopleCost && (
                  <div>
                    <span className="mono" style={{ fontSize: 9, color: "#0E7490" }}>{t("capacity.hourlyCost")}</span>
                    <RateInput value={rateOf(r.id)} onCommit={(v) => void setRate(r.id, v)} title={t("capacity.hourlyCostTitle")} />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <p className="text-xs leading-relaxed" style={{ color: "#64748B" }}>{t("capacity.limitNote")}</p>

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
