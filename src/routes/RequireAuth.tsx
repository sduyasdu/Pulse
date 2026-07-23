import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { firebaseUser, initializing, bootstrapping } = useAuthStore();
  const location = useLocation();

  if (initializing || bootstrapping) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-yasdu-bg">
        <span className="font-display text-sm text-yasdu-muted">Loading Pulse…</span>
      </div>
    );
  }

  // Preserve where they were headed (e.g. a /join/... link) so login returns there.
  if (!firebaseUser) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;

  return <>{children}</>;
}
