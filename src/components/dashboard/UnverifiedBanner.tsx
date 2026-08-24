import { useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { Icon } from "@/components/shared/Icon";
import { useT } from "@/i18n";

/**
 * Tells an unconfirmed account what it's missing, and how to fix it.
 *
 * Accepting an invitation requires a confirmed address (firestore.rules,
 * `myVerifiedEmail`), and the sweep that resolves pending invitations at
 * sign-in is refused outright for these accounts. Without this banner that
 * refusal is completely invisible: the dashboard is simply empty, nothing
 * errors, and someone who was definitely invited has no way to tell whether the
 * invitation was ever sent. This is the one screen that can say otherwise.
 *
 * Not shown for Google accounts — their address arrives confirmed, so there is
 * nothing to act on.
 */
export function UnverifiedBanner() {
  const t = useT();
  const { firebaseUser, emailVerified, resendVerification, recheckVerification } = useAuthStore();
  const [state, setState] = useState<"idle" | "sent" | "failed" | "checking" | "stillUnconfirmed">("idle");

  const isPassword = !!firebaseUser?.providerData.some((p) => p.providerId === "password");
  if (!firebaseUser || emailVerified || !isPassword) return null;

  const resend = async () => {
    setState((await resendVerification()) ? "sent" : "failed");
  };

  const recheck = async () => {
    setState("checking");
    // On success the store flips `emailVerified` and this whole banner
    // unmounts, so there is no success state to render here.
    setState((await recheckVerification()) ? "idle" : "stillUnconfirmed");
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border px-3.5 py-2.5" style={{ borderColor: "#F2C79B", background: "#FFF7F1" }}>
      <Icon name="alternate_email" size={16} />
      <span className="flex-1 text-xs text-yasdu-fg" style={{ minWidth: 220 }}>
        {t("verify.bannerText", { email: firebaseUser.email ?? "" })}
      </span>
      <button
        type="button"
        onClick={() => void recheck()}
        disabled={state === "checking"}
        className="no-press rounded-lg px-2.5 py-1 text-xs font-semibold text-yasdu-primary-fg disabled:opacity-50"
        style={{ background: "#D85A28" }}
      >
        {state === "checking" ? t("verify.checking") : t("verify.confirmedRetry")}
      </button>
      <button type="button" onClick={() => void resend()} className="no-press text-xs hover:underline" style={{ color: "#64748B" }}>
        {state === "sent" ? t("verify.resentOk") : state === "failed" ? t("verify.resendFailed") : t("verify.resend")}
      </button>
      {state === "stillUnconfirmed" && (
        <span className="text-xs text-red-600" style={{ flexBasis: "100%" }}>{t("verify.stillUnconfirmed")}</span>
      )}
    </div>
  );
}
