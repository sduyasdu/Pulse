import type { Comment } from "@/types";
import { createNotification } from "@/services/firestore/notifications";

/** Notify the other people already in this thread (still-members) about a new
 * comment/reply. */
export async function notifyParticipants(opts: {
  pulseId: string;
  targetId: string | null;
  threadComments: Comment[];
  actorUid: string;
  actorEmail: string;
  memberUids: string[];
  featureTitle: string;
  text: string;
}): Promise<void> {
  const members = new Set(opts.memberUids);
  const recipients = [...new Set(opts.threadComments.map((c) => c.authorUid))].filter((p) => p !== opts.actorUid && members.has(p));
  await Promise.all(
    recipients.map((targetUid) =>
      createNotification(opts.pulseId, {
        targetUid,
        actorUid: opts.actorUid,
        actorEmail: opts.actorEmail,
        type: "comment",
        featureId: opts.targetId ?? "",
        featureTitle: opts.featureTitle,
        text: opts.text.slice(0, 90),
        createdAt: Date.now(),
        read: false,
      }),
    ),
  );
}
