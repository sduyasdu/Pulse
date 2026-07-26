import { useT } from "@/i18n";
import { InviteLinkPanel } from "./InviteLinkPanel";

interface InviteDialogProps {
  pulseName: string;
  pulseId: string;
  canEdit: boolean;
  onClose: () => void;
}

export function InviteDialog({ pulseName, pulseId, canEdit, onClose }: InviteDialogProps) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-yasdu-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display mb-1 text-base font-semibold text-yasdu-fg">{t("invite.inviteTo", { name: pulseName })}</h2>
        <p className="mb-4 text-xs text-yasdu-muted">{t("invite.shareLinkHint")}</p>
        <InviteLinkPanel pulseId={pulseId} canEdit={canEdit} />
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg" style={{ background: "#D85A28" }}>
            {t("common.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
