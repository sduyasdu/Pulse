import { useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { usePulseStore } from "@/stores/pulseStore";
import { useAuthStore } from "@/stores/authStore";
import { allocInRange } from "@/domain/assignments";
import { todayIndex } from "@/domain/dateUtils";
import { clamp } from "@/domain/constants";
import { ResourceBadge } from "@/components/shared/ResourceBadge";
import { confirmAt } from "@/stores/confirmStore";

interface TeamTabProps {
  canEdit: boolean;
  filterResource: string | null;
  setFilterResource: (id: string | null) => void;
}

export function TeamTab({ canEdit, filterResource, setFilterResource }: TeamTabProps) {
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
  const [adding, setAdding] = useState(false);
  // Pending link that would attach an account already linked to other
  // resource(s) — resolved by the Cancel / Keep both / Replace dialog.
  const [linkConflict, setLinkConflict] = useState<{ resourceId: string; uid: string; conflicts: { id: string; label: string }[] } | null>(null);

  const accountLabel = (uid: string) => (uid === myUid ? `your account${myEmail ? ` (${myEmail})` : ""}` : members.find((m) => m.uid === uid)?.email ?? "that account");

  const onLinkChange = (resourceId: string, value: string) => {
    const uid = value || null;
    if (!uid) {
      void patchResource(resourceId, { linkedUid: null });
      return;
    }
    const conflicts = resources.filter((x) => x.id !== resourceId && x.linkedUid === uid);
    if (conflicts.length === 0) {
      void patchResource(resourceId, { linkedUid: uid });
      return;
    }
    setLinkConflict({ resourceId, uid, conflicts: conflicts.map((c) => ({ id: c.id, label: c.name?.trim() || c.initials })) });
  };

  const q = query.trim().toLowerCase();
  const filtered = resources.filter((r) => !q || r.name.toLowerCase().includes(q) || (r.type || "").toLowerCase().includes(q));

  // Three forward 4-week windows from today, for the per-resource load
  // indicators (avg allocation over the window ÷ the person's capacity).
  const today = todayIndex();
  const LOAD_WINDOWS = [
    { label: "1–4w", lo: today, hi: today + 28 },
    { label: "5–8w", lo: today + 28, hi: today + 56 },
    { label: "9–12w", lo: today + 56, hi: today + 84 },
  ];

  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 rounded px-2 py-1.5" style={{ border: "1px solid #E2DFD9", background: "#FDFCF8" }}>
        <Icon name="search" size={13} style={{ color: "#64748B" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name or type…"
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
        <span className="mono text-xs" style={{ color: "#64748B" }}>{filtered.length} people</span>
        {canEdit && (
          <button onClick={() => setAdding(true)} className="mono text-xs flex items-center gap-1 px-2 py-0.5 rounded" style={{ background: "#F7E8DA", color: "#D85A28" }}>
            + add
          </button>
        )}
      </div>
      {adding && (
        <input
          autoFocus
          placeholder="Name, then Enter"
          className="w-full text-xs rounded px-2 py-1.5"
          style={{ border: "1px solid #E2DFD9" }}
          onKeyDown={(e) => {
            const target = e.target as HTMLInputElement;
            if (e.key === "Enter" && target.value.trim()) {
              void addResource(target.value, null);
              target.value = "";
              setAdding(false);
            }
            if (e.key === "Escape") setAdding(false);
          }}
          onBlur={() => setAdding(false)}
        />
      )}
      {filterResource && (
        <button onClick={() => setFilterResource(null)} className="w-full flex items-center justify-between px-2 py-1.5 rounded" style={{ background: "#F7E8DA", border: "1px solid #F0A875" }}>
          <span className="mono text-xs" style={{ color: "#D85A28" }}>
            filtering canvas by: {resources.find((x) => x.id === filterResource)?.name ?? filterResource}
          </span>
          <span className="mono text-xs" style={{ color: "#D85A28", display: "inline-flex", alignItems: "center", gap: 3 }}>clear <Icon name="close" size={11} /></span>
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
            title="Drag onto a box to assign · click to filter the canvas"
            style={{ background: active ? "#FFF7F1" : "#FFFFFF", border: active ? "1px solid #EE7240" : "1px solid #E2DFD9" }}
          >
            <div className="flex items-center gap-2">
              <ResourceBadge
                resourceId={r.id}
                size={22}
                ring={r.linkedUid ? "#12A594" : undefined}
                title={r.linkedUid ? "Linked to a real account" : "Freeform placeholder — not linked to an account"}
              />
              <div className="overflow-hidden flex-1">
                <div className="text-xs font-medium truncate" style={{ color: "#1F2330" }}>{r.name}</div>
                <div className="mono truncate" style={{ fontSize: 10, color: "#64748B" }}>{r.type || "—"} · limit {r.capacity}%</div>
              </div>
              {active && <span className="mono text-xs" style={{ color: "#EE7240" }}>●</span>}
              {canEdit && (
                <button
                  title="Duplicate this resource"
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
                  title="Remove this resource"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (await confirmAt(e, { message: `Remove ${r.name}?`, detail: "They'll be unassigned from all tasks.", confirmLabel: "Remove" })) void removeResource(r.id);
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
                  value={r.linkedUid || ""}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onLinkChange(r.id, e.target.value)}
                  className="mono w-full text-[10px] border rounded py-0.5"
                  style={{ borderColor: "#E2DFD9", color: "#64748B", paddingLeft: 22, paddingRight: 4 }}
                  title="Link this Resource to a real Pulse member's account"
                >
                  <option value="">not linked to an account</option>
                  {myUid && <option value={myUid}>My account{myEmail ? ` (${myEmail})` : ""}</option>}
                  {members.filter((m) => m.uid !== myUid).map((m) => (
                    <option key={m.uid} value={m.uid}>{m.email}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        );
      })}

      {linkConflict && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 px-4" style={{ zIndex: 300 }} onClick={() => setLinkConflict(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-yasdu-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display mb-2 text-base font-semibold text-yasdu-fg">Account already linked</h2>
            <p className="text-xs leading-relaxed" style={{ color: "#64748B" }}>
              {accountLabel(linkConflict.uid)} is already linked to {linkConflict.conflicts.map((c) => `“${c.label}”`).join(", ")}.
              {" "}<b>Keep both</b> leaves every resource linked to it; <b>Replace</b> unlinks the {linkConflict.conflicts.length === 1 ? "other one" : "others"}.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setLinkConflict(null)} className="rounded-lg px-3 py-2 text-sm" style={{ color: "#64748B" }}>Cancel</button>
              <button
                onClick={() => { void patchResource(linkConflict.resourceId, { linkedUid: linkConflict.uid }); setLinkConflict(null); }}
                className="rounded-lg px-3 py-2 text-sm font-semibold"
                style={{ background: "#F4F2EC", color: "#334155", border: "1px solid #E2DFD9" }}
              >
                Keep both
              </button>
              <button
                onClick={() => { linkConflict.conflicts.forEach((c) => void patchResource(c.id, { linkedUid: null })); void patchResource(linkConflict.resourceId, { linkedUid: linkConflict.uid }); setLinkConflict(null); }}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg"
                style={{ background: "#D85A28" }}
              >
                Replace
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
