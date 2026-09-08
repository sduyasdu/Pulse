import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/i18n";
import type { TranslationKey } from "@/i18n";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { EmailPasswordForm } from "@/components/auth/EmailPasswordForm";
import { LoginHero } from "@/components/auth/LoginHero";
import { PulseLockup } from "@/components/shared/Logo";
import { Icon } from "@/components/shared/Icon";

/** What someone weighing up an account actually wants to know before typing an
 * address in. Kept to three, and to facts rather than claims. */
const REASSURANCES: TranslationKey[] = ["auth.startFree", "auth.noCard", "auth.noInstall"];

export function LoginPage() {
  const { firebaseUser, initializing, signInWithGoogle, signInWithEmail, registerWithEmail } = useAuthStore();
  const t = useT();
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  if (!initializing && firebaseUser) return <Navigate to={from || "/"} replace />;

  return (
    // `min-h-screen`, not `h-screen`: the page now has content that can exceed
    // a short window, and a fixed height would clip it with no way to scroll.
    <div className="min-h-screen w-full bg-yasdu-bg">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center gap-10 px-4 py-10 lg:flex-row lg:items-center lg:gap-14 lg:py-16">
        {/* Order flips at lg. On a phone the form comes first — most people
            reaching this page already have an account, and making them scroll
            past a pitch to sign in would be charging the many for the few. On a
            wide screen both are visible at once, so the pitch leads. */}
        <LoginHero className="order-2 w-full max-w-xl lg:order-1 lg:flex-1" />

        <div className="order-1 w-full max-w-sm flex-shrink-0 lg:order-2">
          <div className="rounded-2xl border bg-yasdu-card p-7 shadow-sm" style={{ borderColor: "#E2DFD9" }}>
            <div className="mb-6 flex items-center gap-2">
              <PulseLockup variant="light" size={20} />
              <span className="mono text-[10px] uppercase tracking-wide text-yasdu-primary">{t("auth.by")}</span>
            </div>

            <h1 className="font-display mb-1 text-lg font-medium text-yasdu-fg">
              {mode === "signin" ? t("auth.signIn") : t("auth.createAccountTitle")}
            </h1>
            <p className="mb-5 text-sm text-yasdu-muted">{t("auth.tagline")}</p>

            <GoogleButton onClick={() => void signInWithGoogle()} label={t("auth.continueWithGoogle")} />

            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1" style={{ background: "#E2DFD9" }} />
              <span className="mono text-[10px] uppercase text-yasdu-muted">{t("common.or")}</span>
              <div className="h-px flex-1" style={{ background: "#E2DFD9" }} />
            </div>

            <EmailPasswordForm
              mode={mode}
              onSubmit={async (email, password, displayName) => {
                if (mode === "signin") await signInWithEmail(email, password);
                else await registerWithEmail(email, password, displayName);
              }}
            />

            <button
              type="button"
              onClick={() => setMode((m) => (m === "signin" ? "register" : "signin"))}
              className="mt-4 w-full text-center text-xs text-yasdu-muted underline-offset-2 hover:underline"
            >
              {mode === "signin" ? t("auth.newHere") : t("auth.haveAccount")}
            </button>
          </div>

          {/* Outside the card, so it reads as fact about the product rather
              than as more form. */}
          <ul className="mt-4 flex flex-col gap-1.5 px-1">
            {REASSURANCES.map((k) => (
              <li key={k} className="flex items-start gap-2 text-xs text-yasdu-muted">
                <Icon name="check" size={13} style={{ color: "#12A594", flexShrink: 0, marginTop: 1 }} />
                <span>{t(k)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
