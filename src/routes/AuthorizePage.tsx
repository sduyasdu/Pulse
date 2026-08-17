import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { PulseLockup } from "@/components/shared/Logo";
import { Icon } from "@/components/shared/Icon";
import { InlineSpinner } from "@/components/shared/Spinner";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/i18n";

/**
 * `/oauth/authorize` — the consent screen an AI assistant sends the customer to
 * (MCP-Spec.md §2).
 *
 * Behind `RequireAuth`, which preserves the full path **and query string**, so a
 * signed-out customer logs in and lands back here with the OAuth parameters
 * intact rather than on the dashboard wondering what happened.
 *
 * The screen's job is consent, so it states **what the assistant will be able to
 * see, before the button** — not in a tooltip, not afterwards. A consent screen
 * that has to be interpreted is not consent.
 */
export function AuthorizePage() {
  const t = useT();
  const [params] = useSearchParams();
  const email = useAuthStore((s) => s.firebaseUser?.email ?? "");

  const redirectUri = params.get("redirect_uri") ?? "";
  const state = params.get("state") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const challengeMethod = params.get("code_challenge_method") ?? "";
  const clientName = params.get("client_name") ?? params.get("client_id") ?? "";

  const [name, setName] = useState(clientName ? clientName.slice(0, 60) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Everything the server will also check — repeated here only so a
  // misconfigured client gets an explanation instead of a rejected click.
  const usable = redirectUri !== "" && codeChallenge.length >= 32 && challengeMethod === "S256";

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const call = httpsCallable<
        { redirectUri: string; codeChallenge: string; name: string; client: string; scope: string },
        { code: string }
      >(functions, "approveMcpConnection");
      const { data } = await call({
        redirectUri,
        codeChallenge,
        name: name.trim() || t("mcp.defaultName"),
        client: clientName,
        scope: "read",
      });
      // Hand the code back to the client. `assign`, not `replace`: the customer
      // should be able to come back here if the client's callback fails.
      const url = new URL(redirectUri);
      url.searchParams.set("code", data.code);
      if (state) url.searchParams.set("state", state);
      window.location.assign(url.toString());
    } catch (err) {
      setError((err as Error).message || t("mcp.approveError"));
      setBusy(false);
    }
  };

  const deny = () => {
    // Tell the client it was refused, in the shape OAuth expects, rather than
    // leaving it to time out.
    if (!redirectUri) return;
    const url = new URL(redirectUri);
    url.searchParams.set("error", "access_denied");
    if (state) url.searchParams.set("state", state);
    window.location.assign(url.toString());
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-yasdu-bg px-4 py-8">
      <div className="w-full max-w-md rounded-2xl bg-yasdu-card p-6 shadow-lg">
        <PulseLockup variant="light" size={20} />

        {!usable ? (
          <>
            <h1 className="font-display mt-5 text-base font-semibold text-yasdu-fg">{t("mcp.badRequestTitle")}</h1>
            <p className="mt-2 text-sm" style={{ color: "#64748B" }}>{t("mcp.badRequestBody")}</p>
          </>
        ) : (
          <>
            <h1 className="font-display mt-5 text-base font-semibold text-yasdu-fg">
              {t("mcp.title", { client: clientName || t("mcp.anAssistant") })}
            </h1>
            <p className="mt-1 text-xs" style={{ color: "#64748B" }}>{t("mcp.signedInAs", { email })}</p>

            {/* The consent itself. Concrete about what is readable AND explicit
                about what is not — "read-only" is only reassuring if the reader
                believes you know the difference. */}
            <div className="mt-4 rounded-xl border p-3" style={{ borderColor: "#E2DFD9", background: "#FBFAF7" }}>
              <div className="mono text-[10px] uppercase tracking-wide" style={{ color: "#94A3B8" }}>
                {t("mcp.willBeAbleTo")}
              </div>
              <ul className="mt-2 flex flex-col gap-1.5">
                {[t("mcp.canRead"), t("mcp.canSeeSame")].map((line) => (
                  <li key={line} className="flex items-start gap-2 text-xs" style={{ color: "#334155" }}>
                    <Icon name="check" size={14} style={{ color: "#12A594", flexShrink: 0, marginTop: 1 }} />
                    <span>{line}</span>
                  </li>
                ))}
                {[t("mcp.cannotWrite"), t("mcp.cannotBilling")].map((line) => (
                  <li key={line} className="flex items-start gap-2 text-xs" style={{ color: "#64748B" }}>
                    <Icon name="block" size={14} style={{ color: "#94A3B8", flexShrink: 0, marginTop: 1 }} />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            <label className="mt-4 flex flex-col gap-1">
              <span className="mono text-[10px] uppercase tracking-wide" style={{ color: "#94A3B8" }}>
                {t("mcp.nameLabel")}
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("mcp.namePlaceholder")}
                maxLength={60}
                className="rounded-lg border px-3 py-2.5 text-sm outline-none"
                style={{ borderColor: "#E2DFD9", color: "#1F2330" }}
              />
              <span className="text-[11px]" style={{ color: "#94A3B8" }}>{t("mcp.nameHint")}</span>
            </label>

            {error && <p className="mt-3 text-xs" style={{ color: "#DC2626" }}>{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={deny} disabled={busy} className="hoverable rounded-lg border px-3.5 py-2 text-sm disabled:opacity-60" style={{ borderColor: "#E2DFD9", color: "#334155" }}>
                {t("mcp.deny")}
              </button>
              <button
                onClick={() => void approve()}
                disabled={busy}
                className="hoverable rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg disabled:opacity-60"
                style={{ background: "#D85A28" }}
              >
                {busy ? <InlineSpinner /> : t("mcp.approve")}
              </button>
            </div>

            <p className="mt-4 text-[11px] leading-relaxed" style={{ color: "#94A3B8" }}>{t("mcp.revokeNote")}</p>
          </>
        )}
      </div>
    </div>
  );
}
