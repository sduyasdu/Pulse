import { useEffect, useMemo, useState } from "react";
import type { ActivityEntry } from "@/types";
import { usePulseStore } from "@/stores/pulseStore";
import { useAuthStore } from "@/stores/authStore";
import { subscribeActivity } from "@/services/firestore/activity";
import { capsOf } from "@/domain/permissions";
import { colorForName } from "@/domain/constants";
import { useT, t as translateNow } from "@/i18n";

// The shared per-Pulse activity feed (Changelog-Spec.md §6). Reads follow the
// caps model: a My-Beat Viewer only ever sees entries scoped to their beat, so
// we pass their uid and the service issues the required array-contains query.

function initials(nameOrEmail: string): string {
  const base = nameOrEmail.includes("@") ? nameOrEmail.split("@")[0] : nameOrEmail;
  const parts = base.split(/[.\s_-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || base.slice(0, 2).toUpperCase();
}

/** A day heading like "Today", "Yesterday", or "Mar 4". */
function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const yst = new Date(today);
  yst.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return translateNow("activity.today");
  if (d.toDateString() === yst.toDateString()) return translateNow("activity.yesterday");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// A small glyph per entity kind, so the eye can scan the feed by "what".
const KIND_ICON: Record<ActivityEntry["entityKind"], string> = {
  feature: "◆", epic: "▮", resource: "◑", member: "◉", invite: "⇲", pulse: "✦", cost: "$",
};
const KIND_TINT: Record<ActivityEntry["entityKind"], string> = {
  feature: "#123359", epic: "#7C3AED", resource: "#0E7490", member: "#B45309", invite: "#B45309", pulse: "#BE185D", cost: "#8B5CF6",
};

export function ActivityEntryRow({ e, meUid }: { e: ActivityEntry; meUid: string }) {
  const t = useT();
  const photo = usePulseStore((s) => s.members.find((m) => m.uid === e.actorUid)?.photoURL ?? null);
  const who = e.actorUid === meUid ? t("activity.you") : e.actorName || e.actorEmail;
  const glyph = e.entityKind === "invite" ? "⇲" : KIND_ICON[e.entityKind];
  const avatarBase = { width: 22, height: 22, borderRadius: "50%", flexShrink: 0, marginTop: 1 } as const;
  return (
    <div className="flex gap-2.5 px-3 py-2">
      {photo ? (
        <img src={photo} alt={e.actorEmail} title={e.actorEmail} style={{ ...avatarBase, objectFit: "cover", display: "block" }} />
      ) : (
        <span
          className="mono flex items-center justify-center"
          title={e.actorEmail}
          style={{ ...avatarBase, background: colorForName(e.actorUid), color: "#fff", fontSize: 8, fontWeight: 700 }}
        >
          {initials(e.actorName || e.actorEmail)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-xs leading-snug" style={{ color: "#334155" }}>
          <span className="font-semibold">{who}</span> {e.summary}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span style={{ fontSize: 10, color: KIND_TINT[e.entityKind] }}>{glyph}</span>
          <span className="truncate text-[11px] font-medium" style={{ color: "#475569", maxWidth: 180 }} title={e.entityName}>{e.entityName}</span>
          <span className="text-[10px]" style={{ color: "#94A3B8" }}>· {timeLabel(e.at)}</span>
        </div>
        {e.deltas && e.deltas.length > 0 && (
          <div className="mt-1 flex flex-col gap-0.5">
            {e.deltas.map((d, i) => (
              <div key={i} className="flex items-center gap-1 text-[10px]" style={{ color: "#64748B" }}>
                <span className="uppercase tracking-wide" style={{ color: "#94A3B8" }}>{d.key}</span>
                {d.before != null && <span style={{ textDecoration: "line-through", color: "#94A3B8" }}>{d.before}</span>}
                {d.before != null && d.after != null && <span>→</span>}
                {d.after != null && <span style={{ color: "#334155", fontWeight: 600 }}>{d.after}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ActivityTab() {
  const t = useT();
  const pulseId = usePulseStore((s) => s.pulseId);
  const members = usePulseStore((s) => s.members);
  const uid = useAuthStore((s) => s.firebaseUser?.uid);
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);

  // A My-Beat Viewer must query with the array-contains constraint (their own
  // uid); everyone else reads the whole log. Derived from their caps.
  const beatUid = useMemo(() => {
    const me = members.find((m) => m.uid === uid);
    return me && capsOf(me).readScope === "beat" ? uid : undefined;
  }, [members, uid]);

  const [q, setQ] = useState("");

  useEffect(() => {
    if (!pulseId) return;
    setEntries(null);
    return subscribeActivity(pulseId, setEntries, { beatUid });
  }, [pulseId, beatUid]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((e) => matchesQuery(e, needle));
  }, [entries, q]);

  const groups = useMemo(() => {
    const out: { label: string; items: ActivityEntry[] }[] = [];
    for (const e of filtered) {
      const label = dayLabel(e.at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(e);
      else out.push({ label, items: [e] });
    }
    return out;
  }, [filtered]);

  if (entries === null) {
    return <div className="p-6 text-center text-xs" style={{ color: "#94A3B8" }}>{t("activity.loading")}</div>;
  }
  if (entries.length === 0) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: "#64748B" }}>
        {t("activity.empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-4">
      <div className="sticky top-0 z-20 p-2" style={{ background: "#FFFFFF", borderBottom: "1px solid #F1F5F9" }}>
        <div className="relative">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            value={q}
            onChange={(ev) => setQ(ev.target.value)}
            placeholder={t("activity.searchPlaceholder")}
            className="w-full rounded-lg border py-1.5 pl-7 pr-7 text-xs"
            style={{ borderColor: "#E2DFD9", color: "#334155" }}
          />
          {q && (
            <button type="button" onClick={() => setQ("")} title="Clear" className="no-press" style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", fontSize: 14, lineHeight: 1 }}>×</button>
          )}
        </div>
      </div>
      {groups.length === 0 ? (
        <div className="p-6 text-center text-xs" style={{ color: "#94A3B8" }}>{t("activity.noMatch", { query: q.trim() })}</div>
      ) : (
        groups.map((g) => (
          <div key={g.label}>
            <div className="sticky z-10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ top: 45, color: "#94A3B8", background: "#FFFFFF", borderBottom: "1px solid #F1F5F9" }}>
              {g.label}
            </div>
            {g.items.map((e) => (
              <ActivityEntryRow key={e.id} e={e} meUid={uid ?? ""} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

/** Free-text match across the fields a person would search by. `needle` is
 * already lowercased/trimmed. */
function matchesQuery(e: ActivityEntry, needle: string): boolean {
  const hay = [
    e.actorName ?? "", e.actorEmail, e.entityName, e.summary, e.verb, e.entityKind,
    ...(e.deltas ?? []).flatMap((d) => [d.key, d.before ?? "", d.after ?? ""]),
  ].join(" ").toLowerCase();
  return hay.includes(needle);
}
