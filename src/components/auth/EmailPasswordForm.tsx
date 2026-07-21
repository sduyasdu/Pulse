import { useState } from "react";

interface EmailPasswordFormProps {
  mode: "signin" | "register";
  onSubmit: (email: string, password: string, displayName: string) => Promise<void>;
}

export function EmailPasswordForm({ mode, onSubmit }: EmailPasswordFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(email.trim(), password, displayName);
    } catch (err) {
      setError((err as Error).message.replace(/^Firebase:\s*/, ""));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
      {mode === "register" && (
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name"
          className="rounded-lg border px-3 py-2.5 text-sm outline-none"
          style={{ borderColor: "#E2DFD9" }}
        />
      )}
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        className="rounded-lg border px-3 py-2.5 text-sm outline-none"
        style={{ borderColor: "#E2DFD9" }}
      />
      <input
        type="password"
        required
        minLength={6}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="rounded-lg border px-3 py-2.5 text-sm outline-none"
        style={{ borderColor: "#E2DFD9" }}
      />
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button
        type="submit"
        disabled={submitting}
        className="mt-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-yasdu-primary-fg transition-opacity disabled:opacity-50"
        style={{ background: "#D85A28" }}
      >
        {mode === "register" ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
