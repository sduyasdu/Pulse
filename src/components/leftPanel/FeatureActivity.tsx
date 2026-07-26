import { useEffect, useMemo, useState } from "react";
import type { ActivityEntry } from "@/types";
import { usePulseStore } from "@/stores/pulseStore";
import { useAuthStore } from "@/stores/authStore";
import { subscribeFeatureActivity } from "@/services/firestore/activity";
import { capsOf } from "@/domain/permissions";
import { useT } from "@/i18n";
import { ActivityEntryRow } from "./ActivityTab";

/** Inline history for one task, shown at the bottom of its Details (Changelog
 * §6). Same caps-scoped read as the main feed: a My-Beat Viewer queries with
 * their uid so the rules allow the read. */
export function FeatureActivity({ featureId }: { featureId: string }) {
  const t = useT();
  const pulseId = usePulseStore((s) => s.pulseId);
  const members = usePulseStore((s) => s.members);
  const uid = useAuthStore((s) => s.firebaseUser?.uid);
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);

  const beatUid = useMemo(() => {
    const me = members.find((m) => m.uid === uid);
    return me && capsOf(me).readScope === "beat" ? uid : undefined;
  }, [members, uid]);

  useEffect(() => {
    if (!pulseId) return;
    setEntries(null);
    return subscribeFeatureActivity(pulseId, featureId, setEntries, { beatUid });
  }, [pulseId, featureId, beatUid]);

  return (
    <div className="border-t pt-3" style={{ borderColor: "#E2DFD9" }}>
      <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#94A3B8" }}>
        {t("activity.heading")}
      </div>
      {entries === null ? (
        <div className="px-1 py-2 text-[11px]" style={{ color: "#94A3B8" }}>{t("common.loading")}</div>
      ) : entries.length === 0 ? (
        <div className="px-1 py-2 text-[11px]" style={{ color: "#94A3B8" }}>{t("activity.noFeatureChanges")}</div>
      ) : (
        <div className="-mx-1 flex flex-col">
          {entries.map((e) => (
            <ActivityEntryRow key={e.id} e={e} meUid={uid ?? ""} />
          ))}
        </div>
      )}
    </div>
  );
}
