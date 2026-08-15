import { useState } from "react";
import { Icon } from "@/components/shared/Icon";
import type { PulseQuota } from "@/hooks/usePulseQuota";
import { useT } from "@/i18n";

/** localStorage throws in some privacy modes — a lost dismissal is harmless.
 * Same helpers as PlanBanner; kept local rather than shared because the two
 * banners have no other coupling. */
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
    /* ignore — the notice simply reappears next render */
  }
}

/**
 * "You're at your plan's Pulse limit" — informational, never blocking.
 *
 * Dismissible two ways: the × hides it for this session only, "don't show again"
 * persists. The persisted key includes the **limit**, so upgrading (3 → 5) is a
 * new situation and the notice is allowed back — a dismissal shouldn't silence a
 * different fact.
 *
 * Nothing here gates anything. Creating a Pulse is still attempted and still
 * refused by `firestore.rules` if the org is genuinely over; this only explains
 * why, before the attempt.
 */
export function PulseQuotaBanner({ quota, workspaceId, onUpgrade }: { quota: PulseQuota; workspaceId: string | null; onUpgrade: () => void }) {
  const t = useT();
  const dismissKey = `pulse.quotaNotice.${workspaceId ?? "none"}.${quota.limit ?? "unlimited"}`;
  const [hidden, setHidden] = useState(false);

  if (!quota.atLimit || hidden || safeGet(dismissKey) === "1") return null;

  const dismissForever = () => {
    safeSet(dismissKey, "1");
    setHidden(true); // don't wait for the next render to read it back
  };

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2.5 text-xs"
      style={{ background: "#FFF7F1", border: "1px solid #FBD3BE", color: "#9A3412" }}
    >
      <Icon name="info" size={15} style={{ flexShrink: 0 }} />
      <span>{t("plan.pulseLimitReached", { used: quota.used, limit: String(quota.limit) })}</span>

      <div className="ml-auto flex items-center gap-2">
        <button onClick={onUpgrade} className="rounded px-2.5 py-1 font-semibold" style={{ background: "#EE7240", color: "#0A1428" }}>
          {t("plan.upgrade")}
        </button>
        <button onClick={dismissForever} className="underline" style={{ color: "#9A3412", opacity: 0.85 }}>
          {t("plan.dontShowAgain")}
        </button>
        <button
          onClick={() => setHidden(true)}
          aria-label={t("plan.dismissForNow")}
          title={t("plan.dismissForNow")}
          className="no-press flex flex-shrink-0 items-center justify-center rounded"
          style={{ width: 22, height: 22, color: "#9A3412" }}
        >
          <Icon name="close" size={15} />
        </button>
      </div>
    </div>
  );
}
