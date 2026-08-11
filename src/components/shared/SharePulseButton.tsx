import { useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { canNativeShare, shareOrCopy } from "@/domain/share";
import { useT } from "@/i18n";

/**
 * Shares a link to the Pulse you're looking at — the OS share sheet on a
 * phone, the clipboard on a desktop browser without one.
 *
 * It deliberately shares the *plain* Pulse URL, never an invite link. An
 * invite link grants access, and handing one out is a decision that belongs to
 * the invite dialog where you pick the role first — a share button that
 * silently minted access would be a very quiet way to give the whole internet
 * editor rights. Recipients of this link still need to be members.
 */
export function SharePulseButton({ name, dark, compact }: { name?: string | null; dark?: boolean; compact?: boolean }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const label = copied ? t("share.copied") : t("share.share");

  const onShare = async () => {
    // No await before this call: navigator.share needs a live user gesture,
    // and the URL is already in hand.
    const outcome = await shareOrCopy({
      title: name?.trim() || t("common.untitledPulse"),
      text: t("share.text", { name: name?.trim() || t("common.untitledPulse") }),
      url: window.location.href,
    });
    if (outcome === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const title = canNativeShare() ? t("share.shareTitle") : t("share.copyTitle");

  if (compact) {
    return (
      <button
        onClick={() => void onShare()}
        className="flex items-center justify-center rounded"
        style={{ width: 32, height: 32, color: copied ? "#12A594" : "#EE7240" }}
        title={title}
        aria-label={title}
      >
        <Icon name={copied ? "check" : "share"} size={19} />
      </button>
    );
  }

  return (
    <button
      onClick={() => void onShare()}
      className="flex items-center gap-1 px-2 py-0.5 rounded transition-colors hover:brightness-125"
      style={{
        fontSize: 10,
        fontWeight: 600,
        background: dark ? "#1B3A63" : "#F1F5F9",
        color: copied ? "#12A594" : dark ? "#EE7240" : "#334155",
        border: `1px solid ${dark ? "#24406B" : "#E2DFD9"}`,
      }}
      title={title}
    >
      <Icon name={copied ? "check" : "share"} size={12} /> {label}
    </button>
  );
}
