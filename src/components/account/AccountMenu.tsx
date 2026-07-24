import { useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { useAuthStore } from "@/stores/authStore";
import { Avatar } from "./Avatar";
import { AccountDialog } from "./AccountDialog";

/** Avatar button in the dashboard toolbar. Clicking it opens the account menu
 * (My account now; billing/payment are wired to slot in here later), and
 * "My account" opens the profile form. */
export function AccountMenu() {
  const userDoc = useAuthStore((s) => s.userDoc);
  const email = useAuthStore((s) => s.firebaseUser?.email ?? userDoc?.email ?? "");
  const signOutUser = useAuthStore((s) => s.signOutUser);
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState(false);

  const name = userDoc?.displayName?.trim() || "";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center rounded-full"
        title="Account"
        aria-label="Account menu"
        style={{ width: 32, height: 32 }}
      >
        <Avatar photoURL={userDoc?.photoURL} name={name || email} size={32} iconColor="#F0A875" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 60 }} onClick={() => setOpen(false)} />
          <div className="absolute rounded-xl border py-1" style={{ top: "100%", left: 0, marginTop: 8, zIndex: 61, width: 240, background: "#FFFFFF", borderColor: "#E2DFD9", boxShadow: "0 10px 28px rgba(15,23,42,0.16)" }}>
            {/* Identity header */}
            <div className="flex items-center gap-2.5 px-3 py-2.5 border-b" style={{ borderColor: "#F1F5F9" }}>
              <Avatar photoURL={userDoc?.photoURL} name={name || email} size={34} iconColor="#CBD5E1" />
              <div className="min-w-0">
                {name && <div className="text-sm font-semibold truncate" style={{ color: "#1F2330" }}>{name}</div>}
                <div className="text-xs truncate" style={{ color: "#64748B" }}>{email}</div>
              </div>
            </div>

            {/* Items — add future entries (billing, payment, …) to this list. */}
            <div className="py-1">
              <MenuItem icon="person" label="My account" onClick={() => { setOpen(false); setAccount(true); }} />
              <MenuItem icon="credit_card" label="Billing & payment" soon />
            </div>

            <div className="border-t py-1" style={{ borderColor: "#F1F5F9" }}>
              <MenuItem icon="logout" label="Sign out" danger onClick={() => { setOpen(false); void signOutUser(); }} />
            </div>
          </div>
        </>
      )}

      {account && <AccountDialog onClose={() => setAccount(false)} />}
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger, soon }: { icon: string; label: string; onClick?: () => void; danger?: boolean; soon?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={soon}
      className="no-press flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm enabled:hover:bg-yasdu-secondary disabled:cursor-default disabled:opacity-55"
      style={{ color: danger ? "#DC2626" : "#334155" }}
    >
      <Icon name={icon} size={16} style={{ color: danger ? "#DC2626" : "#64748B" }} />
      <span className="flex-1">{label}</span>
      {soon && <span className="mono rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide" style={{ background: "#EEF1F5", color: "#94A3B8" }}>Soon</span>}
    </button>
  );
}
