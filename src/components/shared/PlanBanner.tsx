import { useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { useBilling } from "@/hooks/useBilling";
import { planNotice } from "@/domain/planNotice";
import { useT } from "@/i18n";

/**
 * Delinquency notice for an org whose payment failed (Plans-Spec §5.1).
 *
 * Deliberately low-key: one slim line, no modal, nothing blocked, dismissible.
 * The org keeps working for the whole grace window, so this is a reminder rather
 * than an alarm — it only shifts to a warmer palette once the consequence is
 * imminent. Which message, which palette, and how long a dismissal lasts are all
 * decided by `domain/planNotice`; this component only renders the result.
 *
 * Only the org owner ever sees it — everyone else's billing read resolves to
 * null (see useBilling).
 */

/** localStorage throws in some privacy modes — a lost dismissal is harmless. */
function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore — the notice simply reappears on the next render */
  }
}

export function PlanBanner() {
  const t = useT();
  const { workspaceId, billing } = useBilling();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const notice = planNotice(billing, workspaceId);
  if (!notice) return null;
  if (dismissedKey === notice.dismissKey || safeGet(notice.dismissKey) === "1") return null;

  const palette = notice.urgent
    ? { background: "#FDECEA", borderColor: "#F3C7C1", color: "#8C2F22", icon: "#C0392B" }
    : { background: "#FDF4E5", borderColor: "#EFDCB4", color: "#7A5A1E", icon: "#C08A16" };

  const dismiss = () => {
    safeSet(notice.dismissKey, "1");
    setDismissedKey(notice.dismissKey);
  };

  return (
    <div
      role="status"
      className="flex items-center gap-2.5 border-b px-6 py-2"
      style={{ background: palette.background, borderColor: palette.borderColor, color: palette.color }}
    >
      <Icon name="credit_card" size={16} style={{ color: palette.icon, flexShrink: 0 }} />
      <span className="text-[13px] leading-snug">{t(notice.messageKey, notice.params)}</span>
      <div className="flex-1" />
      {/* Decorative hover only — the button is always visible and tappable, so
          touch (where Tailwind's hover: variant never applies) loses nothing.
          motion-reduce drops the fade under prefers-reduced-motion. */}
      <button
        onClick={dismiss}
        aria-label={t("plan.dismissAria")}
        title={t("plan.dismissAria")}
        className="no-press flex flex-shrink-0 items-center justify-center rounded opacity-70 transition-opacity hover:opacity-100 motion-reduce:transition-none"
        style={{ width: 22, height: 22, color: palette.color }}
      >
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}
