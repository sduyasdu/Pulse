/**
 * Stands in for `@/services/firestore/notifications` while the probe runs.
 *
 * The real subscription calls `collection(db, …)`, and the probe's `db` is a
 * bare object — firebase throws on it, React unwinds the tree, and the shot
 * comes out blank with nothing in it to say why. (It did, once.)
 *
 * The seed is deliberately wordy: this scene exists to catch text spilling out
 * of the 300px dropdown, so short strings would prove nothing.
 */
import type { Notification } from "@/types";

const SEED: Notification[] = [
  {
    id: "n1",
    targetUid: "u1",
    actorUid: "u2",
    type: "comment",
    actorEmail: "alexandra.fernandez@example.com",
    featureId: "f1",
    featureTitle: "Migrate the billing pipeline to the new rates model",
    text: "Can we confirm the cutover date before I start on the reconciliation?",
    createdAt: Date.now() - 9 * 60000,
    read: false,
  },
  {
    id: "n2",
    targetUid: "u1",
    actorUid: "u2",
    type: "comment",
    actorEmail: "sam@example.com",
    featureId: "f2",
    featureTitle: "Quarterly capacity review",
    text: "Pushed this out two weeks.",
    createdAt: Date.now() - 5 * 3600000,
    read: true,
  },
];

export function subscribeMyNotifications(
  _pulseId: string,
  _uid: string,
  cb: (n: Notification[]) => void,
): () => void {
  cb(SEED);
  return () => {};
}

export async function markNotificationRead(): Promise<void> {}
export async function deleteNotification(): Promise<void> {}
export async function createNotification(): Promise<void> {}
