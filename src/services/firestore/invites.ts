import { collection, doc, getDoc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import type { Invite, MyPulseIndexEntry, PendingInviteEntry, Pulse, PulseMember, PulseRole } from "@/types";
import { emailKey } from "./emailKey";
import { fetchMembership } from "./memberships";

/** Lists this Pulse's outstanding (not-yet-accepted) invites. Owner/editor
 * only — enforced by firestore.rules (invites `allow list: canEditPulse`). */
export async function fetchInvites(pulseId: string): Promise<Invite[]> {
  const snap = await getDocs(collection(db, "pulses", pulseId, "invites"));
  return snap.docs.map((d) => d.data() as Invite);
}

/** Invites a collaborator by email to a specific Pulse (spec §8 — not
 * necessarily the whole workspace). Writes both the authoritative invite
 * doc and its discovery pointer in one batch.
 *
 * This doc IS the email-bounded invite link (Current-Spec IV6): the link
 * carries no secret, because the thing being checked is not "did you receive a
 * URL" but "do you control this address", and only the invite doc can answer
 * that. A forwarded link is therefore useless to whoever it was forwarded to.
 */
export async function inviteToPulse(pulseId: string, email: string, role: PulseRole, invitedBy: string): Promise<void> {
  const key = emailKey(email);
  const batch = writeBatch(db);
  const invite: Invite = { email: key, role, invitedBy, createdAt: Date.now() };
  batch.set(doc(db, "pulses", pulseId, "invites", key), invite);
  const pending: PendingInviteEntry = { pulseId, role, invitedBy, createdAt: Date.now() };
  batch.set(doc(db, "inviteIndex", key, "pending", pulseId), pending);
  await batch.commit();
}

/** The URL that goes with `inviteToPulse`. The email is in the query string for
 * one reason: when someone opens it signed in as the wrong account the rules
 * deny them the invite doc, so this is the only way the page can name the
 * address the invitation is actually for. It is display-only and never trusted
 * — the grant is decided by the verified claim in the caller's token. */
export function inviteUrl(pulseId: string, email: string): string {
  return `${window.location.origin}/invite/${pulseId}?to=${encodeURIComponent(emailKey(email))}`;
}

/** Revokes a not-yet-accepted invite. */
export async function revokeInvite(pulseId: string, email: string): Promise<void> {
  const key = emailKey(email);
  const batch = writeBatch(db);
  batch.delete(doc(db, "pulses", pulseId, "invites", key));
  batch.delete(doc(db, "inviteIndex", key, "pending", pulseId));
  await batch.commit();
}

/**
 * Bring the local auth state in line with the server's, and return whether the
 * address is confirmed.
 *
 * `email_verified` is a claim baked into the ID token, and Firebase reuses that
 * token for up to an hour. So someone who confirms their address in another tab
 * — which is exactly how it happens, since the link opens wherever their mail
 * client sends it — is verified at the server while still holding a token that
 * says they are not. The rule reads the token, denies the write, and the app
 * ends up telling them to confirm an address they just confirmed.
 *
 * `reload()` refreshes the user record; `getIdToken(true)` forces a new token so
 * the claim the rules see matches it. Call this before any write the claim
 * gates, not just when the cached flag looks false.
 */
export async function refreshVerification(user: User): Promise<boolean> {
  await user.reload().catch(() => {});
  if (!user.emailVerified) return false;
  await user.getIdToken(true).catch(() => {});
  return true;
}

/**
 * The write half of accepting an invitation, shared by both routes in: the
 * invite link (`InviteAcceptPage`) and the sweep every sign-in does
 * (`resolvePendingInvites`). One implementation because they must agree — the
 * membership doc's shape is what the security rule matches against, so two
 * copies drifting apart would mean one of the two paths silently stops working.
 *
 * Order matters. Membership first (the rule validates it against the invite
 * doc), then the dashboard index — which is only readable once membership
 * exists — then the invite and its pointer, last, because deleting them first
 * would destroy the evidence the rule needs.
 */
export async function acceptInvite(pulseId: string, uid: string, email: string, role: PulseRole): Promise<void> {
  const key = emailKey(email);
  const member: PulseMember = { uid, email: key, role, joinedAt: Date.now() };
  await setDoc(doc(db, "pulses", pulseId, "pulseMembers", uid), member);

  const pulseSnap = await getDoc(doc(db, "pulses", pulseId));
  const p = pulseSnap.exists() ? (pulseSnap.data() as Pulse) : null;
  const entry: MyPulseIndexEntry = {
    pulseId,
    name: p?.name ?? "Untitled Beat",
    workspaceId: p?.workspaceId ?? "",
    role,
    joinedAt: Date.now(),
  };
  await setDoc(doc(db, "users", uid, "myPulses", pulseId), entry);

  const cleanup = writeBatch(db);
  cleanup.delete(doc(db, "pulses", pulseId, "invites", key));
  cleanup.delete(doc(db, "inviteIndex", key, "pending", pulseId));
  await cleanup.commit();
}

/** Why an invite link didn't let someone in. Each one has a different way out,
 * which is the whole reason this isn't a boolean: "confirm your address" and
 * "you're signed in as the wrong person" are both fixable, and a single
 * "couldn't join" message would leave the user guessing which they hit. */
export type InviteAcceptance =
  | { ok: true; role: PulseRole }
  | { ok: false; reason: "unverified" | "notFound" | "failed" };

/**
 * Are we already in? Then there is nothing to accept.
 *
 * A user may always read their OWN pulseMembers doc (firestore.rules:
 * `memberUid == request.auth.uid`), so this answers even for someone who is
 * otherwise a stranger to the Pulse. A denial or a network failure is treated
 * as "not a member", which is the safe reading: the caller then tries the real
 * acceptance and finds out properly.
 */
async function alreadyJoined(pulseId: string, uid: string): Promise<InviteAcceptance | null> {
  const me = await fetchMembership(pulseId, uid).catch(() => null);
  return me ? { ok: true, role: me.role } : null;
}

/**
 * Accept the invitation addressed to this user's own address, if there is one.
 *
 * Deliberately takes no email argument. The address is read off the signed-in
 * user and the grant is decided by the rules against the token's verified
 * claim, so a link that named a different address could not widen anything
 * here even if it tried.
 *
 * A revoked invite and one addressed to somebody else are indistinguishable
 * from this side — the rule refuses to `get` a doc whose `email` isn't yours,
 * and a missing doc fails identically. Both are `notFound`, which is accurate:
 * there is no invitation here for you.
 *
 * Idempotent: accepting when you are already a member succeeds. See below.
 */
export async function acceptInviteFor(pulseId: string, user: User): Promise<InviteAcceptance> {
  /**
   * Membership first, before anything else is asked.
   *
   * There are TWO paths that accept an emailed invite, and they race. The
   * sign-in bootstrap sweeps every pending invitation for the address
   * (`resolvePendingInvites`), and this page accepts the one it was opened for.
   * Opening an invite link normally runs both: the sweep wins during sign-in,
   * grants membership, writes the dashboard entry and DELETES the invite doc —
   * and then this function looked for that doc, did not find it, and reported
   * "there is no invitation here for you".
   *
   * So the invitee was told they could not join a Pulse they had just joined,
   * and then found it sitting on their dashboard. Both halves were true; only
   * the question was wrong.
   *
   * Being a member is the outcome the whole flow exists to produce, so it is
   * checked first and answers every other case too: a link opened twice, two
   * tabs racing, or someone who joined earlier by copy-link and is unverified
   * — who would otherwise be asked to confirm an address in order to obtain
   * access they already have.
   */
  const joined = await alreadyJoined(pulseId, user.uid);
  if (joined) return joined;

  if (!(await refreshVerification(user))) return { ok: false, reason: "unverified" };
  const key = emailKey(user.email ?? "");
  if (!key) return { ok: false, reason: "unverified" };

  let role: PulseRole;
  try {
    const snap = await getDoc(doc(db, "pulses", pulseId, "invites", key));
    // Re-checked rather than reported: the sweep may have completed in the time
    // the verification refresh above took, which is a token round trip.
    if (!snap.exists()) return (await alreadyJoined(pulseId, user.uid)) ?? { ok: false, reason: "notFound" };
    role = (snap.data() as Invite).role;
  } catch {
    return (await alreadyJoined(pulseId, user.uid)) ?? { ok: false, reason: "notFound" };
  }

  try {
    await acceptInvite(pulseId, user.uid, key, role);
    return { ok: true, role };
  } catch {
    // `acceptInvite` is four writes, not one. If it granted membership and then
    // failed on the dashboard entry or the cleanup, the user IS in — reporting
    // failure would be the same lie in a different place.
    return (await alreadyJoined(pulseId, user.uid)) ?? { ok: false, reason: "failed" };
  }
}
