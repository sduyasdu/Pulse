import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { firebaseUser, initializing, bootstrapping } = useAuthStore();

  if (initializing || bootstrapping) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-yasdu-bg">
        <span className="font-display text-sm text-yasdu-muted">Loading Pulse…</span>
      </div>
    );
  }

  if (!firebaseUser) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
