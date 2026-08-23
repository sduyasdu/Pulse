import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@/components/shared/Icon";
import { Spinner } from "@/components/shared/Spinner";
import { useT } from "@/i18n";
import { fetchRosterUsage } from "@/services/firestore/roster";
import type { MasterResource, RosterUsage } from "@/types";

/**
 * Where a roster person is used (Resource-Master-Spec §6, RM7).
 *
 * Read from the server-maintained usage index rather than by searching Pulses,
 * because most of the Pulses in the answer are ones this viewer cannot read.
 *
 * **That is the point, and it is a decided disclosure (RM7/RM19):** a workspace
 * member sees the NAMES of Pulses they cannot open, and who is staffed on them.
 * Accepted because the roster and those Pulses belong to the same organisation,
 * and because asking for access needs something to ask about. So the list says
 * plainly which ones are out of reach rather than showing them as broken links.
 */
export function UsageDialog({ resource, workspaceId, accessiblePulseIds, onClose }: {
  resource: MasterResource;
  workspaceId: string;
  /** The viewer's own Pulses, from their dashboard index — the cheapest way to
   * know what they can open without attempting a read per Pulse. */
  accessiblePulseIds: Set<string>;
  onClose: () => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<RosterUsage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchRosterUsage(workspaceId, resource.id)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [workspaceId, resource.id]);

  const mine = (rows ?? []).filter((r) => accessiblePulseIds.has(r.pulseId));
  const theirs = (rows ?? []).filter((r) => !accessiblePulseIds.has(r.pulseId));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl bg-yasdu-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-base font-semibold text-yasdu-fg">{t("usage.title", { name: resource.name })}</h2>

        {error ? (
          <p className="mt-4 rounded-lg px-3 py-2 text-xs" style={{ background: "#FDECEA", border: "1px solid #F3C7C1", color: "#8C2F22" }}>
            {t("usage.error")}
          </p>
        ) : rows === null ? (
          <Spinner size={20} label={t("common.loading")} className="py-8" />
        ) : rows.length === 0 ? (
          <p className="mt-4 text-xs" style={{ color: "#94A3B8" }}>{t("usage.none")}</p>
        ) : (
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
            <p className="mono mb-2 text-[10px] uppercase tracking-wide" style={{ color: "#94A3B8" }}>
              {t("usage.count", { n: rows.length })}
            </p>

            {mine.map((r) => (
              <Link
                key={r.pulseId}
                to={`/p/${r.pulseId}`}
                className="hoverable no-press flex items-center gap-2 rounded-lg border px-3 py-2"
                style={{ borderColor: "#E2DFD9", marginBottom: 6 }}
              >
                <Icon name="timeline" size={14} style={{ color: "#D85A28" }} />
                <span className="min-w-0 flex-1 truncate text-xs" style={{ color: "#1F2330" }}>{r.pulseName || t("common.untitledPulse")}</span>
                <Icon name="chevron_right" size={14} style={{ color: "#94A3B8" }} />
              </Link>
            ))}

            {theirs.length > 0 && (
              <>
                {/* Named, not hidden — and said out loud, so nobody mistakes a
                    non-link for a bug. */}
                <p className="mono mt-3 mb-1 text-[10px] uppercase tracking-wide" style={{ color: "#94A3B8" }}>
                  {t("usage.noAccessHeading", { n: theirs.length })}
                </p>
                {theirs.map((r) => (
                  <div
                    key={r.pulseId}
                    className="flex items-center gap-2 rounded-lg border px-3 py-2"
                    style={{ borderColor: "#EEF1F4", background: "#FBFAF7", marginBottom: 6 }}
                    title={t("usage.noAccessTitle")}
                  >
                    <Icon name="lock" size={14} style={{ color: "#94A3B8" }} />
                    <span className="min-w-0 flex-1 truncate text-xs" style={{ color: "#64748B" }}>{r.pulseName || t("common.untitledPulse")}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-lg border px-3.5 py-2 text-sm" style={{ borderColor: "#E2DFD9", color: "#334155" }}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
