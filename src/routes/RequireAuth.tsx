import type { ReactNode } from "react";
import { Spinner } from "@/components/shared/Spinner";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { firebaseUser, initializing, bootstrapping } = useAuthStore();
  const location = useLocation();

  if (initializing || bootstrapping) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-yasdu-bg">
        {/* Not translated, for the same reason as App's RouteFallback: this
            renders while auth is still resolving, which precedes the dictionary
            being ready. Names the product, not one Beat — nothing here knows
            which Beat is being opened yet, or whether one is. */}
        <Spinner size={24} label="Loading Beats…" color="#6E7180" />
      </div>
    );
  }

  // Preserve where they were headed (e.g. a /join/... link) so login returns there.
  if (!firebaseUser) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;

  return <>{children}</>;
}
