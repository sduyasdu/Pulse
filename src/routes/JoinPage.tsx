import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { joinPulseViaLink } from "@/services/firestore/joinLinks";
import type { PulseRole } from "@/types";

/** Landing page for a copy-link invite: /join/:pulseId/:token/:role. The user is
 * already signed in (RequireAuth), so we create their membership from the link
 * and forward them into the Pulse. */
export function JoinPage() {
  const { pulseId, token, role } = useParams<{ pulseId: string; token: string; role: string }>();
  const { firebaseUser } = useAuthStore();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !firebaseUser || !pulseId || !token) return;
    ran.current = true;
    const roleVal = (role === "editor" ? "editor" : "viewer") as PulseRole;
    void (async () => {
      try {
        await joinPulseViaLink(pulseId, token, roleVal, firebaseUser.uid, firebaseUser.email ?? "");
        navigate(`/p/${pulseId}`, { replace: true });
      } catch {
        setError("This invite link is invalid or has been revoked. Ask for a fresh link.");
      }
    })();
  }, [firebaseUser, pulseId, token, role, navigate]);

  return (
    <div className="flex h-screen w-full items-center justify-center bg-yasdu-bg px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-yasdu-card p-7 text-center shadow-sm" style={{ borderColor: "#E2DFD9" }}>
        {error ? (
          <>
            <div className="font-display mb-2 text-base font-semibold text-yasdu-fg">Can't join this Pulse</div>
            <p className="mb-4 text-sm text-yasdu-muted">{error}</p>
            <Link to="/" className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg" style={{ background: "#D85A28" }}>Go to dashboard</Link>
          </>
        ) : (
          <span className="font-display text-sm text-yasdu-muted">Joining Pulse…</span>
        )}
      </div>
    </div>
  );
}
