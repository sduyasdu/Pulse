import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { RequireAuth } from "@/routes/RequireAuth";
import { ConfirmPopover } from "@/components/shared/ConfirmPopover";
import { Spinner } from "@/components/shared/Spinner";
import { installActivityRecorder } from "@/domain/activityRecorder";

// Register the activity-log recorder as the undo engine's sink (Changelog-Spec).
// Module-level: runs once, independent of React's mount/StrictMode double-invoke.
installActivityRecorder();

// Route-level code splitting: the heavy Pulse view (canvas, panels, mobile UI)
// loads only when a Pulse is opened, keeping the initial download — the part
// that dominates first paint on mobile — small.
const LoginPage = lazy(() => import("@/routes/LoginPage").then((m) => ({ default: m.LoginPage })));
const DashboardPage = lazy(() => import("@/routes/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const PulsePage = lazy(() => import("@/routes/PulsePage").then((m) => ({ default: m.PulsePage })));
// Lazy like every other route: the roster is a management screen most sessions
// never open, so it should not sit in the dashboard's bundle.
const PeoplePage = lazy(() => import("@/routes/PeoplePage").then((m) => ({ default: m.PeoplePage })));
const JoinPage = lazy(() => import("@/routes/JoinPage").then((m) => ({ default: m.JoinPage })));
const InviteAcceptPage = lazy(() => import("@/routes/InviteAcceptPage").then((m) => ({ default: m.InviteAcceptPage })));
const AuthorizePage = lazy(() => import("@/routes/AuthorizePage").then((m) => ({ default: m.AuthorizePage })));

function RouteFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center" style={{ background: "#FDFCF8" }}>
      {/* Not translated: this renders while a route chunk is still downloading,
          which can precede the dictionary being ready. */}
      <Spinner size={24} label="Loading…" color="#6E7180" />
    </div>
  );
}

function App() {
  const init = useAuthStore((s) => s.init);

  useEffect(() => init(), [init]);

  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/people"
            element={
              <RequireAuth>
                <PeoplePage />
              </RequireAuth>
            }
          />
          <Route
            path="/p/:pulseId"
            element={
              <RequireAuth>
                <PulsePage />
              </RequireAuth>
            }
          />
          <Route
            path="/join/:pulseId/:token/:role"
            element={
              <RequireAuth>
                <JoinPage />
              </RequireAuth>
            }
          />
          {/* The email-bounded invite's landing page. Separate route from
              /join because it is a different kind of thing: /join carries the
              grant in the URL, this one carries only a destination and the
              grant is decided by who signs in. */}
          <Route
            path="/invite/:pulseId"
            element={
              <RequireAuth>
                <InviteAcceptPage />
              </RequireAuth>
            }
          />
          {/* MCP consent (MCP-Spec §2). Behind RequireAuth like everything
              else — and RequireAuth preserves the query string, so a signed-out
              customer logs in and returns here with the OAuth parameters
              intact. */}
          <Route
            path="/oauth/authorize"
            element={
              <RequireAuth>
                <AuthorizePage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <ConfirmPopover />
    </BrowserRouter>
  );
}

export default App;
