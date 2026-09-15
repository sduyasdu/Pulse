import { useEffect, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { Spinner } from "@/components/shared/Spinner";
import { useAuthStore } from "@/stores/authStore";
import { subscribeMcpConnections, revokeMcpConnection, deleteMcpConnection } from "@/services/firestore/users";
import { copyText } from "@/domain/share";
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
 * like data loss. They can then be removed deliberately, which is a second act
 * with its own confirm — see the rules for why deleting is never an off switch.
 */

/**
 * The address a customer pastes into their AI app.
 *
 * Hardcoded to the canonical host rather than built from `window.location.origin`,
 * because the OAuth discovery documents name `https://beats.yasdu.com` as the
 * issuer. Handing someone a connector URL on a different origin than the issuer
 * is the mixed-origin arrangement that already broke client registration once —
 * and it would break it for the customer, in their app, where the error is
 * unreadable. One origin, stated in one place.
 */
const MCP_URL = "https://beats.yasdu.com/mcp";
export function ConnectedAssistantsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const lang = useI18nStore((s) => s.lang);
  const uid = useAuthStore((s) => s.firebaseUser?.uid);
  const [rows, setRows] = useState<McpConnection[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!uid) return;
    return subscribeMcpConnections(uid, (r) => { setRows(r); setError(null); }, setError);
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

  const remove = async (c: McpConnection, e: { clientX: number; clientY: number }) => {
    if (!uid) return;
    const ok = await confirmAt(e, {
      message: t("mcp.removeConfirm", { name: c.name }),
      // Says what it does NOT do, because the dangerous misreading is that this
      // is the disconnect. It already is disconnected; this clears the record.
      detail: t("mcp.removeDetail"),
      confirmLabel: t("mcp.removeAction"),
    });
    if (!ok) return;
    setBusy(c.id);
    try {
      await deleteMcpConnection(uid, c.id);
    } catch {
      setError(t("mcp.removeError"));
    } finally {
      setBusy(null);
    }
  };

  const copyUrl = async () => {
    setCopied(await copyText(MCP_URL));
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-6" onClick={onClose}>
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-yasdu-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-base font-semibold text-yasdu-fg">{t("account.connectedAssistants")}</h2>
        <p className="mt-1 text-xs" style={{ color: "#64748B" }}>{t("mcp.listIntro")}</p>

        {/* The connector URL sits above the list because it is what someone
            opening this dialog with nothing connected actually came for. */}
        <div className="mt-4 rounded-xl border p-3" style={{ borderColor: "#E2DFD9", background: "#FBFAF7" }}>
          <div className="mono text-[10px] uppercase tracking-wide" style={{ color: "#94A3B8" }}>
            {t("mcp.connectUrlLabel")}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <code
              className="mono min-w-0 flex-1 truncate rounded-lg border px-2.5 py-1.5 text-[11px]"
              style={{ borderColor: "#E2DFD9", background: "#FFFFFF", color: "#1F2330" }}
              title={MCP_URL}
            >
              {MCP_URL}
            </code>
            <button
              onClick={() => void copyUrl()}
              className="hoverable flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold"
              style={{ borderColor: "#E2DFD9", color: copied ? "#0F7B6C" : "#334155" }}
            >
              <Icon name={copied ? "check" : "content_copy"} size={14} />
              {copied ? t("mcp.copied") : t("mcp.copy")}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "#94A3B8" }}>{t("mcp.connectUrlHint")}</p>
        </div>

        {error ? (
          // Distinct from "none connected" on purpose — see the note on
          // subscribeMcpConnections. An unreadable list is a fault, not a state.
          <p className="mt-5 rounded-lg px-3 py-2 text-xs" style={{ background: "#FDECEA", border: "1px solid #F3C7C1", color: "#8C2F22" }}>
            {t("mcp.listError")}
          </p>
        ) : rows === null ? (
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
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="mono rounded px-2 py-0.5 text-[9px] uppercase tracking-wide" style={{ background: "#EEF1F5", color: "#94A3B8" }}>
                        {t("mcp.revoked")}
                      </span>
                      {/* Always visible rather than hover-revealed: a tablet has
                          no hover, and a row action behind one is unreachable. */}
                      <button
                        onClick={(e) => void remove(c, e)}
                        disabled={busy === c.id}
                        title={t("mcp.removeAction")}
                        aria-label={t("mcp.removeAction")}
                        className="hoverable rounded-lg border p-1 disabled:opacity-50"
                        style={{ borderColor: "#E2DFD9", color: "#94A3B8" }}
                      >
                        <Icon name="delete" size={14} />
                      </button>
                    </div>
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
