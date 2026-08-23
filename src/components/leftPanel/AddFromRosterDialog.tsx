import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { Spinner, InlineSpinner } from "@/components/shared/Spinner";
import { useT } from "@/i18n";
import { subscribeRoster, copyRosterToPulse, initialsOf, type CopyRosterResult } from "@/services/firestore/roster";
import { subscribeTeams } from "@/services/firestore/teams";
import type { MasterResource, Team } from "@/types";

/**
 * Add people from the workspace roster into this Pulse (Resource-Master-Spec
 * RM15) — individually, or a whole team at once.
 *
 * What lands in the Pulse is a **copy**, not a reference (RM1): the Pulse stays
 * readable by collaborators who are not workspace members, which a reference
 * would break. The copy keeps a `masterId` so it can be traced back, and the
 * person's email so it resolves to them if they are ever invited here.
 */
export function AddFromRosterDialog({ pulseId, workspaceId, alreadyLinked, onClose }: {
  pulseId: string;
  workspaceId: string;
  /** `masterId`s already present in this Pulse — shown as added rather than
   * offered again, so the dialog does not invite a no-op. */
  alreadyLinked: Set<string>;
  onClose: () => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<MasterResource[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [denied, setDenied] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CopyRosterResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    // A Pulse collaborator who is not a workspace member cannot read the roster,
    // and that is correct — it is the org's people, not this Pulse's. Say so
    // rather than showing an empty list, which would read as "nobody there".
    return subscribeRoster(workspaceId, (r) => { setRows(r); setDenied(false); }, () => { setRows([]); setDenied(true); });
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeTeams(workspaceId, setTeams);
  }, [workspaceId]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => (rows ?? []).filter((r) => !q || (r.name ?? "").toLowerCase().includes(q) || (r.type ?? "").toLowerCase().includes(q)),
    [rows, q],
  );

  const toggle = (id: string) => setPicked((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /** Members of this team that could still be added. */
  const selectableIn = (teamId: string) =>
    (rows ?? []).filter((r) => (r.teamIds ?? []).includes(teamId) && !alreadyLinked.has(r.id)).map((r) => r.id);

  /** Whether clicking the team again would clear it — i.e. everyone it can
   * contribute is already picked. Drives the pressed look, so the button says
   * what a second click will do. */
  const teamFullySelected = (teamId: string) => {
    const ids = selectableIn(teamId);
    return ids.length > 0 && ids.every((id) => picked.has(id));
  };

  /**
   * Toggle a whole team.
   *
   * Selecting rather than copying immediately, so a twenty-person team is still
   * one reviewable action — and clicking again clears it, because a control that
   * only adds leaves no way back except unpicking twenty people by hand.
   */
  const pickTeam = (teamId: string) => {
    const ids = selectableIn(teamId);
    const clearing = teamFullySelected(teamId);
    setPicked((cur) => {
      const next = new Set(cur);
      for (const id of ids) if (clearing) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (picked.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await copyRosterToPulse(pulseId, [...picked]));
      setPicked(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl bg-yasdu-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-base font-semibold text-yasdu-fg">{t("addRoster.title")}</h2>
        <p className="mt-1 text-xs" style={{ color: "#64748B" }}>{t("addRoster.intro")}</p>

        {denied ? (
          <p className="mt-4 rounded-lg px-3 py-2 text-xs" style={{ background: "#FEF3C7", border: "1px solid #FDE68A", color: "#92400E" }}>
            {t("addRoster.noAccess")}
          </p>
        ) : rows === null ? (
          <Spinner size={20} label={t("common.loading")} className="py-8" />
        ) : rows.length === 0 ? (
          <p className="mt-4 text-xs" style={{ color: "#94A3B8" }}>{t("addRoster.emptyRoster")}</p>
        ) : (
          <>
            {teams.length > 0 && (
              <div className="mt-3">
                <div className="mono text-[10px] uppercase tracking-wide" style={{ color: "#94A3B8" }}>{t("addRoster.wholeTeam")}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {teams.map((tm) => {
                    const on = teamFullySelected(tm.id);
                    return (
                      <button
                        key={tm.id}
                        onClick={() => pickTeam(tm.id)}
                        aria-pressed={on}
                        title={on ? t("addRoster.clearTeam", { team: tm.name }) : t("addRoster.selectTeam", { team: tm.name })}
                        className="hoverable no-press mono rounded px-2 py-1 text-[10px] font-semibold"
                        // Selected reads as filled; unselected as an outline of
                        // the same colour, so the pair is one control in two
                        // states rather than two different buttons.
                        style={on
                          ? { background: tm.color, color: "#FFFFFF", border: `1px solid ${tm.color}` }
                          : { background: "#FFFFFF", color: tm.color, border: `1px solid ${tm.color}` }}
                      >
                        {tm.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="relative mt-3">
              <Icon name="search" size={14} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", pointerEvents: "none" }} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("addRoster.searchPlaceholder")}
                className="w-full rounded-lg border text-xs"
                style={{ borderColor: "#E2DFD9", padding: "8px 28px", outline: "none" }}
              />
            </div>

            <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-lg border" style={{ borderColor: "#E2DFD9" }}>
              {visible.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs" style={{ color: "#94A3B8" }}>{t("addRoster.noMatch")}</p>
              ) : (
                visible.map((r) => {
                  const here = alreadyLinked.has(r.id);
                  const on = picked.has(r.id);
                  return (
                    <button
                      key={r.id}
                      disabled={here}
                      onClick={() => toggle(r.id)}
                      // no-press: the ungated global button scale (index.css) would
                      // grow a full-width row past the list that clips it.
                      className="no-press hoverable flex w-full items-center gap-2 border-b px-2.5 py-2 text-left last:border-b-0 disabled:opacity-45"
                      style={{ borderColor: "#F5F3EF", background: on ? "#FFF7F1" : undefined }}
                    >
                      <span
                        className="flex shrink-0 items-center justify-center rounded"
                        style={{ width: 16, height: 16, border: `1px solid ${on ? "#D85A28" : "#CBD5E1"}`, background: on ? "#D85A28" : "#FFFFFF" }}
                      >
                        {on && <Icon name="check" size={11} style={{ color: "#FFFFFF" }} />}
                      </span>
                      <span className="mono flex shrink-0 items-center justify-center rounded-full text-[9px] font-bold" style={{ width: 22, height: 22, background: "#F1F5F9", color: "#475569" }}>
                        {r.initials || initialsOf(r.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs" style={{ color: "#1F2330" }}>{r.name}</span>
                        {r.type && <span className="mono block truncate text-[10px]" style={{ color: "#94A3B8" }}>{r.type}</span>}
                      </span>
                      {here && <span className="mono shrink-0 text-[9px] uppercase" style={{ color: "#94A3B8" }}>{t("addRoster.alreadyHere")}</span>}
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* What actually happened, split by reason — "some of them" has to say
            which ones and why, especially when the quota is what stopped it. */}
        {result && (
          <div className="mt-3 rounded-lg px-3 py-2 text-xs" style={{ background: "#E7F6F1", border: "1px solid #B7E4D6", color: "#0F5F52" }}>
            <div>{t("addRoster.copied", { n: result.copied })}</div>
            {result.skippedAlreadyPresent > 0 && <div style={{ opacity: 0.85 }}>{t("addRoster.skippedPresent", { n: result.skippedAlreadyPresent })}</div>}
            {result.skippedOverQuota > 0 && (
              <div style={{ color: "#8C2F22" }}>{t("addRoster.skippedQuota", { n: result.skippedOverQuota, limit: result.limit })}</div>
            )}
          </div>
        )}
        {error && <p className="mt-3 text-xs" style={{ color: "#DC2626" }}>{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm" style={{ color: "#64748B" }}>{t("common.close")}</button>
          <button
            onClick={() => void submit()}
            disabled={picked.size === 0 || busy}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg disabled:opacity-50"
            style={{ background: "#D85A28" }}
          >
            {busy ? <InlineSpinner /> : t("addRoster.addSelected", { n: picked.size })}
          </button>
        </div>
      </div>
    </div>
  );
}
