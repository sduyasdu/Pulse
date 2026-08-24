import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { acceptInviteFor } from "@/services/firestore/invites";
import { emailKey } from "@/services/firestore/emailKey";
import { logDirectActivity } from "@/domain/activityRecorder";
import { roleMeta } from "@/domain/permissions";
import { useT } from "@/i18n";
import { Spinner } from "@/components/shared/Spinner";

/** Looks enough like an address to show back to the user.
 *
 * `?to=` is attacker-controllable — it's a URL parameter — and it gets rendered
 * into a sentence about who an invitation belongs to. React escapes it, so the
 * risk isn't markup; it's that arbitrary text in that sentence reads as
 * something Pulse is telling you. Anything that isn't shaped like an address is
 * dropped and the sentence falls back to not naming one. */
function displayableEmail(raw: string | null): string | null {
  if (!raw) return null;
  const v = emailKey(raw);
  return /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(v) ? v : null;
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-yasdu-bg px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-yasdu-card p-7 text-center shadow-sm" style={{ borderColor: "#E2DFD9" }}>
        {title && <div className="font-display mb-2 text-base font-semibold text-yasdu-fg">{title}</div>}
        {children}
      </div>
    </div>
  );
}

type State =
  | { kind: "working" }
  | { kind: "wrongAccount"; invited: string | null }
  | { kind: "unverified" }
  | { kind: "notFound" }
  | { kind: "failed" };

/**
 * Landing page for an email-bounded invite: `/invite/:pulseId?to=<email>`.
 *
 * The sibling of `JoinPage`, and deliberately not the same thing. A `/join`
 * link is a capability — whoever holds it gets in, which is what makes it handy
 * for "post it in the team channel" and unsuitable for one named person. This
 * one grants nothing on its own: the invitation lives in
 * `pulses/{id}/invites/{email}` and only a confirmed owner of that address can
 * act on it, so forwarding the URL accomplishes nothing.
 *
 * Which means most of this page is the failure cases. Someone arriving here has
 * already been told they were invited, so "couldn't join" is a dead end — each
 * refusal names what happened and offers the way out of it.
 */
export function InviteAcceptPage() {
  const { pulseId } = useParams<{ pulseId: string }>();
  const [params] = useSearchParams();
  const { firebaseUser, signOutUser, resendVerification } = useAuthStore();
  const t = useT();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "working" });
  const [resent, setResent] = useState<"idle" | "sent" | "failed">("idle");
  const ran = useRef(false);

  const invited = displayableEmail(params.get("to"));
  const mine = firebaseUser?.email ? emailKey(firebaseUser.email) : "";

  const attempt = useCallback(async () => {
    if (!firebaseUser || !pulseId) return;
    setState({ kind: "working" });

    // Checked before the write, purely so the message can be useful. The rules
    // would refuse this anyway — but only with "permission denied", which can't
    // tell someone they're signed in as the wrong person.
    if (invited && mine && invited !== mine) {
      setState({ kind: "wrongAccount", invited });
      return;
    }

    const result = await acceptInviteFor(pulseId, firebaseUser);
    if (result.ok) {
      logDirectActivity(pulseId, {
        entityKind: "member", entityId: firebaseUser.uid, entityName: mine || "A new member",
        verb: "add", summary: `joined as ${roleMeta(result.role).label}`,
      });
      navigate(`/p/${pulseId}`, { replace: true });
      return;
    }
    setState({ kind: result.reason });
  }, [firebaseUser, pulseId, invited, mine, navigate]);

  useEffect(() => {
    if (ran.current || !firebaseUser || !pulseId) return;
    ran.current = true;
    void attempt();
  }, [attempt, firebaseUser, pulseId]);

  const resend = async () => {
    setResent((await resendVerification()) ? "sent" : "failed");
  };

  if (state.kind === "working") {
    return <Shell title=""><Spinner size={24} label={t("join.accepting")} /></Shell>;
  }

  if (state.kind === "wrongAccount") {
    return (
      <Shell title={t("join.wrongAccount")}>
        <p className="mb-4 text-sm text-yasdu-muted">
          {t("join.wrongAccountDetail", { invited: state.invited ?? "", mine })}
        </p>
        <button
          onClick={() => void signOutUser()}
          className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg"
          style={{ background: "#D85A28" }}
        >
          {t("join.signOutAndSwitch")}
        </button>
      </Shell>
    );
  }

  if (state.kind === "unverified") {
    return (
      <Shell title={t("join.confirmFirst")}>
        <p className="mb-4 text-sm text-yasdu-muted">{t("join.confirmFirstDetail", { email: mine })}</p>
        <div className="flex flex-col gap-2">
          {/* Retry rather than "reload the page": confirming happens in another
              tab, and the token this session holds still says unconfirmed until
              it's refreshed. acceptInviteFor forces that refresh. */}
          <button
            onClick={() => void attempt()}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg"
            style={{ background: "#D85A28" }}
          >
            {t("join.confirmedRetry")}
          </button>
          <button onClick={() => void resend()} className="text-xs text-yasdu-muted hover:underline">
            {resent === "sent" ? t("join.resentOk") : resent === "failed" ? t("join.resendFailed") : t("join.resend")}
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={t("join.cantJoin")}>
      <p className="mb-4 text-sm text-yasdu-muted">
        {state.kind === "notFound" ? t("join.noInvite", { email: mine }) : t("join.acceptFailed")}
      </p>
      <div className="flex flex-col gap-2">
        {state.kind === "failed" && (
          <button
            onClick={() => void attempt()}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg"
            style={{ background: "#D85A28" }}
          >
            {t("common.retry")}
          </button>
        )}
        <Link to="/" className="text-xs text-yasdu-muted hover:underline">{t("join.goToDashboard")}</Link>
      </div>
    </Shell>
  );
}
