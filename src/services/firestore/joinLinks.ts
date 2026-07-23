import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { InviteLink, MyPulseIndexEntry, Pulse, PulseMember, PulseRole } from "@/types";

function newToken(): string {
  // Unguessable capability. randomUUID is 122 bits of entropy — plenty for a
  // share link; strip dashes for a tidier URL.
  return (crypto.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`).replace(/-/g, "");
}

/** Generate (or replace) the Pulse's active copy-link invite for a role, and
 * return the token. Owner/editor only (enforced by the pulse update rule). */
export async function setPulseInviteLink(pulseId: string, role: PulseRole): Promise<InviteLink> {
  const invite: InviteLink = { token: newToken(), role };
  await updateDoc(doc(db, "pulses", pulseId), { invite, updatedAt: Date.now() });
  return invite;
}

/** Revoke the active link (any outstanding link stops working immediately). */
export async function clearPulseInviteLink(pulseId: string): Promise<void> {
  await updateDoc(doc(db, "pulses", pulseId), { invite: null, updatedAt: Date.now() });
}

/** Read a Pulse's current invite link (members only — for the share UI). */
export async function getPulseInviteLink(pulseId: string): Promise<InviteLink | null> {
  const snap = await getDoc(doc(db, "pulses", pulseId));
  return snap.exists() ? ((snap.data() as Pulse).invite ?? null) : null;
}

/**
 * Join a Pulse via a copy-link. Creates the caller's own membership doc
 * (validated against the Pulse's active `invite` by the security rule), then —
 * now a member and able to read the Pulse — writes the dashboard index entry.
 * No-op if already a member.
 */
export async function joinPulseViaLink(pulseId: string, token: string, role: PulseRole, uid: string, email: string): Promise<void> {
  const existing = await getDoc(doc(db, "pulses", pulseId, "pulseMembers", uid));
  if (!existing.exists()) {
    const member: PulseMember = { uid, email, role, joinedAt: Date.now(), joinToken: token };
    await setDoc(doc(db, "pulses", pulseId, "pulseMembers", uid), member);
  }
  const snap = await getDoc(doc(db, "pulses", pulseId));
  const p = snap.exists() ? (snap.data() as Pulse) : null;
  const entry: MyPulseIndexEntry = {
    pulseId,
    name: p?.name ?? "",
    workspaceId: p?.workspaceId ?? "",
    role: existing.exists() ? (existing.data() as PulseMember).role : role,
    joinedAt: Date.now(),
  };
  await setDoc(doc(db, "users", uid, "myPulses", pulseId), entry);
}
