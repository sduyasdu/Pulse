import { collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { emailKey } from "./emailKey";
import type { MasterResource } from "@/types";

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
  input: { name: string; initials?: string; type?: string | null; capacity?: number; linkedEmail?: string | null },
): Promise<string> {
  const id = newMasterResourceId(workspaceId);
  const name = input.name.trim();
  const master: MasterResource = {
    id,
    name,
    initials: (input.initials?.trim() || initialsOf(name)).slice(0, 3).toUpperCase(),
    type: input.type ?? null,
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
  patch: Partial<Pick<MasterResource, "name" | "initials" | "type" | "capacity" | "linkedEmail" | "teamIds">>,
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
