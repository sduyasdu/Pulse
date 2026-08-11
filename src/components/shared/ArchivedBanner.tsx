import { Icon } from "@/components/shared/Icon";
import { useT } from "@/i18n";

// The archived Pulse's persistent explanation (Hide-and-Archive-Spec §5.2).
// Read-only has to be *explained*, not just enforced, or it reads as a bug:
// every control being dead with no reason given is indistinguishable from a
// broken page.
//
// Unlike PlanBanner, this is NOT dismissible. A delinquency notice is a
// deadline you can acknowledge; this is the current state of the thing you're
// looking at, and hiding it would leave the disabled UI unexplained.

interface ArchivedBannerProps {
  /** Owners get the action; everyone else gets told who to ask. */
  isOwner: boolean;
  onUnarchive: () => void;
}

export function ArchivedBanner({ isOwner, onUnarchive }: ArchivedBannerProps) {
  const t = useT();
  return (
    <div
      role="status"
      className="flex items-center gap-2.5 border-b px-6 py-2"
      style={{ background: "#EEF1F5", borderColor: "#D9DEE6", color: "#3E4A5B" }}
    >
      <Icon name="archive" size={16} style={{ color: "#64748B", flexShrink: 0 }} />
      <span className="text-[13px] leading-snug">
        {isOwner ? t("pulse.archivedBanner") : t("pulse.archivedBannerMember")}
      </span>
      <div className="flex-1" />
      {isOwner && (
        <button
          onClick={onUnarchive}
          className="flex flex-shrink-0 items-center gap-1 rounded px-2 py-1 text-[12px] font-semibold transition-colors hover:brightness-105"
          style={{ background: "#FFFFFF", border: "1px solid #D9DEE6", color: "#1B3A63" }}
        >
          <Icon name="unarchive" size={14} style={{ color: "#64748B" }} />
          {t("pulse.unarchive")}
        </button>
      )}
    </div>
  );
}
