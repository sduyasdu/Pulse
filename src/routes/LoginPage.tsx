import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { EmailPasswordForm } from "@/components/auth/EmailPasswordForm";

export function LoginPage() {
  const { firebaseUser, initializing, signInWithGoogle, signInWithEmail, registerWithEmail } = useAuthStore();
  const [mode, setMode] = useState<"signin" | "register">("signin");

  if (!initializing && firebaseUser) return <Navigate to="/" replace />;

  return (
    <div className="flex h-screen w-full items-center justify-center bg-yasdu-bg px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-yasdu-card p-7 shadow-sm" style={{ borderColor: "#E2DFD9" }}>
        <div className="mb-6 flex items-center gap-2">
          <span className="font-display text-xl font-semibold text-yasdu-blue">Pulse</span>
          <span className="mono text-[10px] uppercase tracking-wide text-yasdu-primary">by Yasdu</span>
        </div>

        <h1 className="font-display mb-1 text-lg font-medium text-yasdu-fg">
          {mode === "signin" ? "Sign in" : "Create your account"}
        </h1>
        <p className="mb-5 text-sm text-yasdu-muted">Visual, graph-first project planning.</p>

        <GoogleButton onClick={() => void signInWithGoogle()} />

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1" style={{ background: "#E2DFD9" }} />
          <span className="mono text-[10px] uppercase text-yasdu-muted">or</span>
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
          {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
