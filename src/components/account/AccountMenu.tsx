import { useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { useAuthStore } from "@/stores/authStore";
import { useI18nStore } from "@/stores/i18nStore";
import { useT, LANG_ENDONYMS, SUPPORTED_LANGS, type Lang } from "@/i18n";
import { Avatar } from "./Avatar";
import { AccountDialog } from "./AccountDialog";
import { BillingDialog } from "./BillingDialog";

/** Avatar button in the dashboard toolbar. Clicking it opens the account menu
 * (My account, the language override, billing later), and "My account" opens
 * the profile form. */
export function AccountMenu() {
  const userDoc = useAuthStore((s) => s.userDoc);
  const email = useAuthStore((s) => s.firebaseUser?.email ?? userDoc?.email ?? "");
  const signOutUser = useAuthStore((s) => s.signOutUser);
  const saveProfile = useAuthStore((s) => s.saveProfile);
  const lang = useI18nStore((s) => s.lang);
  const overridden = useI18nStore((s) => s.overridden);
  const setLang = useI18nStore((s) => s.setLang);
  const setAuto = useI18nStore((s) => s.setAuto);
  const t = useT();
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState(false);
  const [billing, setBilling] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  const name = userDoc?.displayName?.trim() || "";

  // Apply a language override live (i18nStore) and persist it: localStorage for
  // instant reload + the user doc for cross-device sync.
  const chooseLang = (l: Lang) => {
    setLang(l);
    void saveProfile({ language: l });
    setLangOpen(false);
  };
  // "Auto" clears the override and reverts to browser detection everywhere.
  const chooseAuto = () => {
    setAuto();
    void saveProfile({ language: null });
    setLangOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center rounded-full"
        title={t("account.title")}
        aria-label={t("account.menuAria")}
        style={{ width: 32, height: 32 }}
      >
        <Avatar photoURL={userDoc?.photoURL} name={name || email} size={32} iconColor="#F0A875" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 60 }} onClick={() => { setOpen(false); setLangOpen(false); }} />
          <div className="absolute rounded-xl border py-1" style={{ top: "100%", right: 0, marginTop: 8, zIndex: 61, width: 240, background: "#FFFFFF", borderColor: "#E2DFD9", boxShadow: "0 10px 28px rgba(15,23,42,0.16)" }}>
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
              <MenuItem icon="person" label={t("account.myAccount")} onClick={() => { setOpen(false); setAccount(true); }} />

              {/* Language override: current selection shown, expands to the six
                  endonyms plus an "Auto (browser)" option that clears it. */}
              <button
                onClick={() => setLangOpen((o) => !o)}
                className="no-press flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-yasdu-secondary"
                style={{ color: "#334155" }}
              >
                <Icon name="language" size={16} style={{ color: "#64748B" }} />
                <span className="flex-1">{t("account.language")}</span>
                <span className="text-xs" style={{ color: "#94A3B8" }}>{overridden ? LANG_ENDONYMS[lang] : t("account.languageAuto")}</span>
                <Icon name={langOpen ? "keyboard_arrow_up" : "keyboard_arrow_down"} size={15} style={{ color: "#94A3B8" }} />
              </button>
              {langOpen && (
                <div className="py-0.5" style={{ background: "#FAFAF8" }}>
                  <LangOption label={t("account.languageAuto")} active={!overridden} onClick={chooseAuto} />
                  {SUPPORTED_LANGS.map((l) => (
                    <LangOption key={l} label={LANG_ENDONYMS[l]} active={overridden && lang === l} onClick={() => chooseLang(l)} />
                  ))}
                </div>
              )}

              <MenuItem icon="credit_card" label={t("account.billing")} onClick={() => { setOpen(false); setBilling(true); }} />
            </div>

            <div className="border-t py-1" style={{ borderColor: "#F1F5F9" }}>
              <MenuItem icon="logout" label={t("account.signOut")} danger onClick={() => { setOpen(false); void signOutUser(); }} />
            </div>
          </div>
        </>
      )}

      {account && <AccountDialog onClose={() => setAccount(false)} />}
      {billing && <BillingDialog onClose={() => setBilling(false)} />}
    </div>
  );
}

function LangOption({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="no-press flex w-full items-center gap-2 py-1.5 pl-9 pr-3 text-left text-sm hover:bg-yasdu-secondary"
      style={{ color: active ? "#D85A28" : "#334155", fontWeight: active ? 600 : 400 }}
    >
      <span className="flex-1">{label}</span>
      {active && <Icon name="check" size={15} style={{ color: "#D85A28" }} />}
    </button>
  );
}

function MenuItem({ icon, label, onClick, danger, soon, soonLabel }: { icon: string; label: string; onClick?: () => void; danger?: boolean; soon?: boolean; soonLabel?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={soon}
      className="no-press flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm enabled:hover:bg-yasdu-secondary disabled:cursor-default disabled:opacity-55"
      style={{ color: danger ? "#DC2626" : "#334155" }}
    >
      <Icon name={icon} size={16} style={{ color: danger ? "#DC2626" : "#64748B" }} />
      <span className="flex-1">{label}</span>
      {soon && <span className="mono rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide" style={{ background: "#EEF1F5", color: "#94A3B8" }}>{soonLabel}</span>}
    </button>
  );
}
