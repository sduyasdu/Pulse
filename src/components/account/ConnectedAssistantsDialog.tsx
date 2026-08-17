import { useEffect, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { Spinner } from "@/components/shared/Spinner";
import { useAuthStore } from "@/stores/authStore";
import { subscribeMcpConnections, revokeMcpConnection } from "@/services/firestore/users";
import { confirmAt } from "@/stores/confirmStore";
import { useI18nStore } from "@/stores/i18nStore";
import { useT } from "@/i18n";
import type { McpConnection } from "@/types";

/**
 * Account → Connected assistants (MCP-Spec §3).
 *
 * The revocation surface the whole token design exists to support. Revoking
 * takes effect on the assistant's next request and stops it renewing (§2.1), so
 * this is the real off switch rather than a cosmetic list.
 *
 * Revoked connections stay listed rather than disappearing: a customer who
 * revokes something wants to see that they did, and a row that vanishes reads
 * like data loss.
 */
export function ConnectedAssistantsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const lang = useI18nStore((s) => s.lang);
  const uid = useAuthStore((s) => s.firebaseUser?.uid);
  const [rows, setRows] = useState<McpConnection[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    return subscribeMcpConnections(uid, setRows);
  }, [uid]);

  const when = (ms?: number | null) =>
    ms ? new Date(ms).toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric" }) : null;

  const revoke = async (c: McpConnection, e: { clientX: number; clientY: number }) => {
    if (!uid) return;
    const ok = await confirmAt(e, {
      message: t("mcp.revokeConfirm", { name: c.name }),
      detail: t("mcp.revokeDetail"),
      confirmLabel: t("mcp.revokeAction"),
    });
    if (!ok) return;
    setBusy(c.id);
    try {
      await revokeMcpConnection(uid, c.id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-6" onClick={onClose}>
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-yasdu-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-base font-semibold text-yasdu-fg">{t("account.connectedAssistants")}</h2>
        <p className="mt-1 text-xs" style={{ color: "#64748B" }}>{t("mcp.listIntro")}</p>

        {rows === null ? (
          <Spinner size={20} label={t("common.loading")} className="py-8" />
        ) : rows.length === 0 ? (
          <p className="mt-5 text-sm" style={{ color: "#94A3B8" }}>{t("mcp.listEmpty")}</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {rows.map((c) => {
              const revoked = !!c.revokedAt;
              return (
                <li
                  key={c.id}
                  className="flex items-start gap-3 rounded-xl border p-3"
                  style={{ borderColor: "#E2DFD9", background: revoked ? "#FAFAF8" : "#FFFFFF", opacity: revoked ? 0.7 : 1 }}
                >
                  <Icon name="smart_toy" size={18} style={{ color: revoked ? "#94A3B8" : "#64748B", flexShrink: 0, marginTop: 2 }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold" style={{ color: "#1F2330" }}>{c.name}</div>
                    <div className="mono mt-0.5 text-[10px]" style={{ color: "#94A3B8" }}>
                      {[
                        c.client,
                        // "Read-only" is the reassurance; say it rather than
                        // making the customer infer it from an absent warning.
                        t(c.scope === "write" ? "mcp.scopeWrite" : "mcp.scopeRead"),
                        c.lastUsedAt ? t("mcp.lastUsed", { date: when(c.lastUsedAt)! }) : t("mcp.neverUsed"),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  {revoked ? (
                    <span className="mono rounded px-2 py-0.5 text-[9px] uppercase tracking-wide" style={{ background: "#EEF1F5", color: "#94A3B8" }}>
                      {t("mcp.revoked")}
                    </span>
                  ) : (
                    <button
                      onClick={(e) => void revoke(c, e)}
                      disabled={busy === c.id}
                      className="hoverable rounded-lg border px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                      style={{ borderColor: "#F3C7C1", color: "#9F1D23" }}
                    >
                      {t("mcp.revokeAction")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="hoverable rounded-lg border px-3.5 py-2 text-sm" style={{ borderColor: "#E2DFD9", color: "#334155" }}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
