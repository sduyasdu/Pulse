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

const YASDU_URL = "https://www.yasdu.com";

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
    // A column, so `flex-1` on the content keeps the footer at the bottom of a
    // tall window rather than floating up under the card.
    <div className="flex min-h-screen w-full flex-col bg-yasdu-bg">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-8 px-4 py-8 lg:flex-row lg:items-center lg:gap-12 lg:py-10">
        {/* Order flips at lg. On a phone the form comes first — most people
            reaching this page already have an account, and making them scroll
            past a pitch to sign in would be charging the many for the few. On a
            wide screen both are visible at once, so the pitch leads. */}
        <LoginHero className="order-2 w-full max-w-xl lg:order-1 lg:flex-1" />

        <div className="order-1 w-full max-w-sm flex-shrink-0 lg:order-2">
          <div className="rounded-2xl border bg-yasdu-card p-7 shadow-sm" style={{ borderColor: "#E2DFD9" }}>
            <div className="mb-6">
              <PulseLockup variant="light" size={20} />
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

      {/*
        Whose product this is, and where to find out more.
        `yasdu-lockup-dark.png` is the brand kit's "naranja blanco" lockup:
        orange mark, WHITE wordmark. That is why this strip is dark — on the
        page's own off-white the wordmark would simply not be there, and the
        logo would read as a floating orange icon. The blue is the one the
        Pulse header and the marketing site already use.
      */}
      <footer style={{ background: "#123359" }}>
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-4 sm:flex-row sm:justify-between">
          <a
            href={YASDU_URL}
            target="_blank"
            rel="noreferrer"
            className="transition-opacity hover:opacity-80"
            aria-label="Yasdu"
          >
            {/* Sized, not left to reflow: the intrinsic file is 427×124, and
                letting it load unsized would jog the footer as it arrives. */}
            <img src="/brand/yasdu-lockup-dark.png" alt="Yasdu" width={96} height={28} style={{ display: "block" }} />
          </a>

          <p className="text-center text-xs sm:text-right" style={{ color: "#94A3B8" }}>
            {/* The year is computed, not written down — a hard-coded one is
                wrong every January and nobody notices until a customer does. */}
            {t("auth.copyright", { year: new Date().getFullYear() })}
            <span className="mx-1.5" aria-hidden="true">·</span>
            <a
              href={YASDU_URL}
              target="_blank"
              rel="noreferrer"
              className="underline-offset-2 hover:underline"
              style={{ color: "#F0A875" }}
            >
              www.yasdu.com
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
