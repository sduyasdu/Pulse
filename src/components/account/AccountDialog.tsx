import { useRef, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { useAuthStore } from "@/stores/authStore";
import { fileToAvatarDataUrl } from "@/lib/image";
import { Avatar } from "./Avatar";

/** The "My Account" form: set a picture and display name; the username (email)
 * is shown read-only. */
export function AccountDialog({ onClose }: { onClose: () => void }) {
  const userDoc = useAuthStore((s) => s.userDoc);
  const email = useAuthStore((s) => s.firebaseUser?.email ?? userDoc?.email ?? "");
  const saveProfile = useAuthStore((s) => s.saveProfile);

  const [name, setName] = useState(userDoc?.displayName ?? "");
  const [photo, setPhoto] = useState<string | null>(userDoc?.photoURL ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setError(null);
    try {
      setPhoto(await fileToAvatarDataUrl(file));
    } catch (err) {
      setError((err as Error).message || "Couldn't use that image.");
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await saveProfile({ displayName: name.trim() || null, photoURL: photo });
      onClose();
    } catch (err) {
      setError((err as Error).message || "Couldn't save — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-yasdu-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display mb-4 text-base font-semibold text-yasdu-fg">My account</h2>
        <form onSubmit={save} className="flex flex-col gap-4">
          {/* Picture */}
          <div className="flex items-center gap-3">
            <Avatar photoURL={photo} name={name} size={64} iconColor="#CBD5E1" />
            <div className="flex flex-col gap-1.5">
              <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold" style={{ borderColor: "#E2DFD9", color: "#334155" }}>
                <Icon name="edit" size={13} /> {photo ? "Change picture" : "Add a picture"}
              </button>
              {photo && (
                <button type="button" onClick={() => setPhoto(null)} className="flex items-center gap-1 text-xs" style={{ color: "#DC2626" }}>
                  <Icon name="delete" size={13} /> Remove
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void pickFile(e)} />
          </div>

          {/* Name */}
          <label className="flex flex-col gap-1">
            <span className="mono text-[10px] uppercase tracking-wide text-yasdu-muted">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="rounded-lg border px-3 py-2.5 text-sm outline-none"
              style={{ borderColor: "#E2DFD9", color: "#1F2330" }}
            />
          </label>

          {/* Username (read-only) */}
          <label className="flex flex-col gap-1">
            <span className="mono text-[10px] uppercase tracking-wide text-yasdu-muted">Username</span>
            <div className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm" style={{ borderColor: "#E2DFD9", background: "#F8FAFC", color: "#64748B" }}>
              <Icon name="account_circle" size={15} style={{ color: "#94A3B8" }} />
              <span className="truncate">{email || "—"}</span>
            </div>
          </label>

          {error && <span className="text-xs text-red-600">{error}</span>}

          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-yasdu-muted">Cancel</button>
            <button type="submit" disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg disabled:opacity-50" style={{ background: "#D85A28" }}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
