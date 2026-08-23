import { collection, deleteDoc, doc, getDocs, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { emailKey } from "./emailKey";
import type { MasterResource, RosterUsage } from "@/types";

/**
 * The workspace roster (Resource-Master-Spec §1) — one list of people, which
 * Pulses copy from.
 *
 * A Pulse never reads this. It holds its own copies, because Pulse membership is
 * independent of workspace membership (RM1): making a Pulse depend on this
 * collection would either break for invited collaborators or expose the whole
 * org's roster to them.
 *
 * **`linkedUid` is absent from every write here on purpose.** A client writes
 * `linkedEmail` — the intent — and a server trigger resolves the uid against real
 * membership (RM16). The rules refuse a client-written uid, because it is what
 * the UI reads to say someone is a live collaborator (RM20), and that must be a
 * fact rather than a claim.
 */

export function newMasterResourceId(workspaceId: string): string {
  return doc(collection(db, "workspaces", workspaceId, "resources")).id;
}

/** Live roster, alphabetical.
 *
 * `onError` is separate from the empty case for the reason recorded in
 * `CLAUDE.md`: collapsing a denied read into an empty list makes "this workspace
 * has no people" and "you may not see them" identical on screen. */
export function subscribeRoster(
  workspaceId: string,
  cb: (rows: MasterResource[]) => void,
  onError?: (message: string) => void,
): () => void {
  return onSnapshot(
    collection(db, "workspaces", workspaceId, "resources"),
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MasterResource);
      rows.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
      cb(rows);
    },
    (err) => onError?.(err.message),
  );
}

export async function createMasterResource(
  workspaceId: string,
  input: { name: string; initials?: string; role?: string | null; capacity?: number; linkedEmail?: string | null },
): Promise<string> {
  const id = newMasterResourceId(workspaceId);
  const name = input.name.trim();
  const master: MasterResource = {
    id,
    name,
    initials: (input.initials?.trim() || initialsOf(name)).slice(0, 3).toUpperCase(),
    role: input.role ?? null,
    capacity: input.capacity ?? 100,
    linkedEmail: input.linkedEmail ? emailKey(input.linkedEmail) : null,
    createdAt: Date.now(),
  };
  await setDoc(doc(db, "workspaces", workspaceId, "resources", id), master);
  return id;
}

/** Patch. `linkedEmail` is normalised here so every writer agrees with the
 * resolver's comparison — the one place that inconsistency was found, it was
 * silently breaking matches for anyone with a capital letter in their address. */
export async function patchMasterResource(
  workspaceId: string,
  id: string,
  patch: Partial<Pick<MasterResource, "name" | "initials" | "role" | "capacity" | "linkedEmail" | "teamIds">>,
): Promise<void> {
  const clean = { ...patch };
  if (patch.linkedEmail !== undefined) clean.linkedEmail = patch.linkedEmail ? emailKey(patch.linkedEmail) : null;
  await updateDoc(doc(db, "workspaces", workspaceId, "resources", id), clean);
}

/** Delete a roster entry. Copies already inside Pulses are DETACHED, not deleted
 * (RM13) — by a server trigger, because the owner doing this is routinely not a
 * member of the Pulses holding them. */
export async function deleteMasterResource(workspaceId: string, id: string): Promise<void> {
  await deleteDoc(doc(db, "workspaces", workspaceId, "resources", id));
}

/** "Ana Torres" → "AT". Matches how a Pulse resource gets its initials, so a
 * person looks the same on both sides. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ---------------------------------------------------------------------------
// Copying roster people into a Pulse (RM15)
// ---------------------------------------------------------------------------

export interface CopyRosterResult {
  copied: number;
  skippedAlreadyPresent: number;
  skippedMissing: number;
  skippedOverQuota: number;
  limit: number;
  used: number;
}

/**
 * Copy roster entries into a Pulse.
 *
 * A **callable**, not a client loop, and the reason is not convenience:
 * `resourceCount` is written asynchronously, so N parallel creates would all be
 * evaluated against the same stale count and all N would pass the quota rule.
 * The server checks once and writes once, which is the only ordering that
 * bounds a burst (Resource-Master-Spec §8.3).
 *
 * Returns what it actually did, split by reason — copied, already present, over
 * quota — because "some of them" needs to say which ones and why.
 */
export async function copyRosterToPulse(pulseId: string, masterIds: string[]): Promise<CopyRosterResult> {
  const call = httpsCallable<{ pulseId: string; masterIds: string[] }, CopyRosterResult>(functions, "copyRosterToPulse");
  const { data } = await call({ pulseId, masterIds });
  return data;
}

/** The org role of a roster entry.
 *
 * Reads `type` as a fallback: before RM24 split role from type, the role lived
 * in `type`. Entries written then keep working, and `roleSelfHeal` moves them
 * across the first time the People screen sees them. */
export const roleOf = (r: MasterResource): string | null => r.role ?? r.type ?? null;

/** Move a pre-RM24 entry's role out of `type` into `role`.
 *
 * A self-heal rather than a migration script, for the reason recorded about
 * SF11's backfill: a script somebody has to remember to run is a script that
 * does not get run. Idempotent, and silent on failure — a non-owner simply
 * cannot, and the fallback read keeps their view correct anyway. */
export async function roleSelfHeal(workspaceId: string, rows: MasterResource[]): Promise<void> {
  for (const r of rows) {
    if (r.role != null || r.type == null) continue;
    await patchMasterResource(workspaceId, r.id, { role: r.type }).catch(() => {});
  }
}

/** Which Pulses hold a copy of this person (RM7).
 *
 * A one-shot read, not a subscription: it is opened from a dialog, and the
 * answer does not change while someone is looking at it. */
export async function fetchRosterUsage(workspaceId: string, masterId: string): Promise<RosterUsage[]> {
  const snap = await getDocs(collection(db, "workspaces", workspaceId, "resources", masterId, "usage"));
  const rows = snap.docs.map((d) => d.data() as RosterUsage);
  rows.sort((a, b) => (a.pulseName ?? "").localeCompare(b.pulseName ?? ""));
  return rows;
}
