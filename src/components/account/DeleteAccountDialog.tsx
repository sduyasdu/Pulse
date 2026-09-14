import { useEffect, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { Spinner } from "@/components/shared/Spinner";
import { useT } from "@/i18n";
import { useAuthStore } from "@/stores/authStore";
import { previewAccountDeletion, deleteAccount, type DeletionPreview, type DeletionBlocker } from "@/services/firestore/account";

/**
 * Account deletion (SF15).
 *
 * The dialog leads with consequences, not with a warning: it asks the server
 * what deleting would actually do and shows that, because "this cannot be
 * undone" tells someone nothing about whether they are about to lose one
 * scratch Beat or four years of work.
 *
 * Confirmation is by typing the account's own email address rather than a word
 * like DELETE. It cannot be typed by muscle memory, it cannot be mistranslated,
 * and it is the one string that is unambiguously *this* account.
 */
export function DeleteAccountDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const t = useT();
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the server refuses because ownership must move first. Overrides
   * the preview's own list, since it is the fresher of the two. */
  const [blockers, setBlockers] = useState<DeletionBlocker[] | null>(null);
  /** The server wants a fresher sign-in. Handled here rather than by sending
   * the user away: signing out and back in would close this dialog and lose
   * everything they just read and confirmed. */
  const [needsReauth, setNeedsReauth] = useState(false);
  const [password, setPassword] = useState("");
  const [reauthFailed, setReauthFailed] = useState(false);
  const reauthenticate = useAuthStore((s) => s.reauthenticate);
  const needsPassword = useAuthStore((s) => s.needsPasswordToReauth)();

  useEffect(() => {
    let live = true;
    previewAccountDeletion()
      .then((p) => live && setPreview(p))
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const shownBlockers = blockers ?? preview?.blockers ?? [];
  const blocked = shownBlockers.length > 0 || preview?.subscription != null;
  const confirmed = typed.trim().toLowerCase() === email.trim().toLowerCase();

  const run = async () => {
    setBusy(true);
    setError(null);
    setReauthFailed(false);
    const result = await deleteAccount();
    if (result.ok) {
      // The account is gone, so there is nothing to sign out of and no state
      // worth preserving. A hard reload drops the terminated Firestore
      // instance and the cached data with it, and lands on the sign-in page.
      window.location.replace("/");
      return;
    }
    setBusy(false);
    if (result.reason === "sole-owner-beats") setBlockers(result.blockers);
    else if (result.reason === "active-subscription") setPreview((p) => (p ? { ...p, canDelete: false } : p));
    else if (result.reason === "reauth-required") setNeedsReauth(true);
    // "partial" means the teardown began and stopped. Retrying is safe — every
    // step is idempotent — and saying so matters more than an apology.
    else setError(result.reason === "partial" ? t("del.partial") : t("del.failed"));
  };

  /** Prove identity, then go straight back to deleting — the person already
   * confirmed; making them press the red button twice adds nothing. */
  const proveAndRetry = async () => {
    setBusy(true);
    setReauthFailed(false);
    const ok = await reauthenticate(needsPassword ? password : undefined);
    if (!ok) {
      setBusy(false);
      setReauthFailed(true);
      return;
    }
    setNeedsReauth(false);
    setPassword("");
    await run();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-6" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t("del.title")}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-yasdu-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2.5">
          <Icon name="delete_forever" size={20} style={{ color: "#DC2626", flexShrink: 0, marginTop: 1 }} />
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-yasdu-fg">{t("del.title")}</h2>
            <p className="mt-1 text-xs" style={{ color: "#64748B" }}>{t("del.intro")}</p>
          </div>
        </div>

        {loadFailed ? (
          <p className="mt-5 rounded-lg px-3 py-2 text-xs" style={{ background: "#FDECEA", border: "1px solid #F3C7C1", color: "#8C2F22" }}>
            {t("common.loadError")}
          </p>
        ) : preview === null ? (
          <Spinner size={20} label={t("del.checking")} className="py-8" />
        ) : (
          <>
            {/* What actually happens, in the order it matters. */}
            <ul className="mt-4 flex flex-col gap-2 rounded-xl border p-3" style={{ borderColor: "#E2DFD9", background: "#FBFAF7" }}>
              {preview.deletes.length > 0 && (
                <Consequence tone="bad" text={t("del.beatsDeleted", { n: preview.deletes.length })} />
              )}
              {preview.leaves.length > 0 && <Consequence text={t("del.beatsLeft", { n: preview.leaves.length })} />}
              {preview.deletes.length === 0 && preview.leaves.length === 0 && <Consequence text={t("del.nothingElse")} />}
              <Consequence text={t("del.alsoGone")} />
              <Consequence text={t("del.staysBehind")} />
            </ul>

            {shownBlockers.length > 0 && (
              <div className="mt-4 rounded-xl border p-3" style={{ borderColor: "#F3C7C1", background: "#FDECEA" }}>
                <div className="flex items-start gap-2">
                  <Icon name="warning" size={16} style={{ color: "#8C2F22", flexShrink: 0, marginTop: 1 }} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold" style={{ color: "#8C2F22" }}>{t("del.blockerTitle")}</div>
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: "#8C2F22" }}>{t("del.blockerDetail")}</p>
                    <ul className="mt-2 flex flex-col gap-1">
                      {shownBlockers.map((b) => (
                        <li key={b.beatId} className="text-xs font-medium" style={{ color: "#8C2F22" }}>
                          {t("del.blockerRow", { name: b.name, n: b.otherMembers })}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {preview.subscription && (
              <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "#F3C7C1", background: "#FDECEA" }}>
                <div className="flex items-start gap-2">
                  <Icon name="credit_card" size={16} style={{ color: "#8C2F22", flexShrink: 0, marginTop: 1 }} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold" style={{ color: "#8C2F22" }}>{t("del.subTitle")}</div>
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: "#8C2F22" }}>{t("del.subDetail")}</p>
                  </div>
                </div>
              </div>
            )}

            {needsReauth && (
              <div className="mt-4 rounded-xl border p-3" style={{ borderColor: "#F0A875", background: "#FFF7F1" }}>
                <div className="text-sm font-semibold" style={{ color: "#9A3412" }}>{t("del.reauthTitle")}</div>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: "#9A3412" }}>{t("del.reauth")}</p>
                {needsPassword && (
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("del.password")}
                    className="mt-2 w-full rounded-lg border px-2.5 py-2 text-sm"
                    style={{ borderColor: "#E2DFD9", background: "#FFFFFF", color: "#1F2330", outline: "none" }}
                  />
                )}
                {reauthFailed && (
                  <p className="mt-2 text-xs font-medium" style={{ color: "#8C2F22" }}>{t("del.reauthFailed")}</p>
                )}
                <button
                  onClick={() => void proveAndRetry()}
                  disabled={busy || (needsPassword && password.length === 0)}
                  className="hoverable no-press mt-2 rounded-lg px-3 py-2 text-sm font-semibold disabled:cursor-default disabled:opacity-50"
                  style={{ background: "#EE7240", color: "#FFFFFF" }}
                >
                  {busy ? t("del.deleting") : t("del.reauthCta")}
                </button>
              </div>
            )}

            {!blocked && !needsReauth && (
              <label className="mt-4 block">
                <span className="text-xs font-medium" style={{ color: "#334155" }}>{t("del.confirm")}</span>
                <input
                  type="email"
                  autoComplete="off"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={email}
                  className="mt-1.5 w-full rounded-lg border px-2.5 py-2 text-sm"
                  style={{ borderColor: "#E2DFD9", background: "#FFFFFF", color: "#1F2330", outline: "none" }}
                />
              </label>
            )}

            {error && (
              <p className="mt-3 rounded-lg px-3 py-2 text-xs" style={{ background: "#FDECEA", border: "1px solid #F3C7C1", color: "#8C2F22" }}>
                {error}
              </p>
            )}
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="hoverable no-press rounded-lg px-3 py-2 text-sm font-semibold"
            style={{ background: "#F1F5F9", color: "#475569" }}
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => void run()}
            disabled={busy || blocked || needsReauth || !confirmed || preview === null}
            className="hoverable no-press rounded-lg px-3 py-2 text-sm font-semibold disabled:cursor-default disabled:opacity-50"
            style={{ background: "#DC2626", color: "#FFFFFF" }}
          >
            {busy ? t("del.deleting") : t("del.cta")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Consequence({ text, tone }: { text: string; tone?: "bad" }) {
  return (
    <li className="flex items-start gap-2 text-xs leading-relaxed" style={{ color: tone === "bad" ? "#8C2F22" : "#475569" }}>
      <Icon
        name={tone === "bad" ? "delete_forever" : "check"}
        size={14}
        style={{ color: tone === "bad" ? "#DC2626" : "#94A3B8", flexShrink: 0, marginTop: 2 }}
      />
      <span>{text}</span>
    </li>
  );
}
