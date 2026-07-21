import { collection, doc, getDocs, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Invite, PendingInviteEntry, PulseRole } from "@/types";
import { emailKey } from "./emailKey";

/** Lists this Pulse's outstanding (not-yet-accepted) invites. Owner/editor
 * only — enforced by firestore.rules (invites `allow list: canEditPulse`). */
export async function fetchInvites(pulseId: string): Promise<Invite[]> {
  const snap = await getDocs(collection(db, "pulses", pulseId, "invites"));
  return snap.docs.map((d) => d.data() as Invite);
}

/** Invites a collaborator by email to a specific Pulse (spec §8 — not
 * necessarily the whole workspace). Writes both the authoritative invite
 * doc and its discovery pointer in one batch. */
export async function inviteToPulse(pulseId: string, email: string, role: PulseRole, invitedBy: string): Promise<void> {
  const key = emailKey(email);
  const batch = writeBatch(db);
  const invite: Invite = { email: key, role, invitedBy, createdAt: Date.now() };
  batch.set(doc(db, "pulses", pulseId, "invites", key), invite);
  const pending: PendingInviteEntry = { pulseId, role, invitedBy, createdAt: Date.now() };
  batch.set(doc(db, "inviteIndex", key, "pending", pulseId), pending);
  await batch.commit();
}

/** Revokes a not-yet-accepted invite. */
export async function revokeInvite(pulseId: string, email: string): Promise<void> {
  const key = emailKey(email);
  const batch = writeBatch(db);
  batch.delete(doc(db, "pulses", pulseId, "invites", key));
  batch.delete(doc(db, "inviteIndex", key, "pending", pulseId));
  await batch.commit();
}
