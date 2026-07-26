import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { joinPulseViaLink } from "@/services/firestore/joinLinks";
import { logDirectActivity } from "@/domain/activityRecorder";
import { roleMeta } from "@/domain/permissions";
import { useT } from "@/i18n";
import type { PulseRole } from "@/types";

// Roles a copy-link may grant — must match the invite allow-list the security
// rules enforce (firestore.rules pulse `invite.role`). Anything else falls back
// to the safest read-only role.
const GRANTABLE: PulseRole[] = ["editor", "taskLead", "myBeatViewer", "viewer"];

/** Landing page for a copy-link invite: /join/:pulseId/:token/:role. The user is
 * already signed in (RequireAuth), so we create their membership from the link
 * and forward them into the Pulse. */
export function JoinPage() {
  const { pulseId, token, role } = useParams<{ pulseId: string; token: string; role: string }>();
  const { firebaseUser } = useAuthStore();
  const t = useT();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !firebaseUser || !pulseId || !token) return;
    ran.current = true;
    const roleVal = GRANTABLE.includes(role as PulseRole) ? (role as PulseRole) : "viewer";
    void (async () => {
      try {
        await joinPulseViaLink(pulseId, token, roleVal, firebaseUser.uid, firebaseUser.email ?? "");
        logDirectActivity(pulseId, {
          entityKind: "member", entityId: firebaseUser.uid, entityName: firebaseUser.email ?? "A new member",
          verb: "add", summary: `joined as ${roleMeta(roleVal).label}`,
        });
        navigate(`/p/${pulseId}`, { replace: true });
      } catch {
        setError(t("join.invalidLink"));
      }
    })();
  }, [firebaseUser, pulseId, token, role, navigate, t]);

  return (
    <div className="flex h-screen w-full items-center justify-center bg-yasdu-bg px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-yasdu-card p-7 text-center shadow-sm" style={{ borderColor: "#E2DFD9" }}>
        {error ? (
          <>
            <div className="font-display mb-2 text-base font-semibold text-yasdu-fg">{t("join.cantJoin")}</div>
            <p className="mb-4 text-sm text-yasdu-muted">{error}</p>
            <Link to="/" className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg" style={{ background: "#D85A28" }}>{t("join.goToDashboard")}</Link>
          </>
        ) : (
          <span className="font-display text-sm text-yasdu-muted">{t("join.joining")}</span>
        )}
      </div>
    </div>
  );
}
