import { arrayRemove, arrayUnion, collection, doc, getDocs, onSnapshot, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Team } from "@/types";

/**
 * Teams (Resource-Master-Spec RM4) — a grouping over the roster.
 *
 * A team document holds a name and a colour and **no people**. Membership lives
 * on the resource as `teamIds[]`, which makes many-to-many fall out and answers
 * both directions without a join collection.
 */

/** A fixed palette rather than a picker: eight distinguishable accents keep a
 * workspace legible, where free colour choice reliably produces eight greys. */
export const TEAM_COLORS = ["#D85A28", "#0F766E", "#1B3A63", "#7C3AED", "#B45309", "#BE185D", "#0369A1", "#4D7C0F"];

export function subscribeTeams(
  workspaceId: string,
  cb: (rows: Team[]) => void,
  onError?: (message: string) => void,
): () => void {
  return onSnapshot(
    collection(db, "workspaces", workspaceId, "teams"),
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Team);
      rows.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
      cb(rows);
    },
    (err) => onError?.(err.message),
  );
}

export async function createTeam(workspaceId: string, name: string, usedColors: string[] = []): Promise<string> {
  const ref = doc(collection(db, "workspaces", workspaceId, "teams"));
  // Prefer a colour not already in use, so two teams created in a row look
  // different without anyone choosing.
  const color = TEAM_COLORS.find((c) => !usedColors.includes(c)) ?? TEAM_COLORS[usedColors.length % TEAM_COLORS.length];
  await setDoc(ref, { id: ref.id, name: name.trim(), color, createdAt: Date.now() } satisfies Team);
  return ref.id;
}

export async function renameTeam(workspaceId: string, teamId: string, name: string): Promise<void> {
  await updateDoc(doc(db, "workspaces", workspaceId, "teams", teamId), { name: name.trim() });
}

/**
 * Delete a team, and take its id off every person who was in it.
 *
 * The membership lives on the resources, so deleting only the team document
 * would leave every member carrying a `teamIds` entry pointing at nothing —
 * invisible, and it would resurface the moment anything grouped by team id.
 * Client-side is correct here: only a workspace owner can do either write, and
 * the roster is small and bounded.
 */
export async function deleteTeam(workspaceId: string, teamId: string): Promise<void> {
  const members = await getDocs(
    query(collection(db, "workspaces", workspaceId, "resources"), where("teamIds", "array-contains", teamId)),
  );
  const batch = writeBatch(db);
  for (const m of members.docs) batch.update(m.ref, { teamIds: arrayRemove(teamId) });
  batch.delete(doc(db, "workspaces", workspaceId, "teams", teamId));
  await batch.commit();
}

/** Assign / unassign. `arrayUnion` and `arrayRemove` are atomic server-side, so
 * two people dragging at once cannot clobber each other's change — a plain
 * read-modify-write of the array could. */
export async function setTeamMembership(workspaceId: string, resourceId: string, teamId: string, member: boolean): Promise<void> {
  await updateDoc(doc(db, "workspaces", workspaceId, "resources", resourceId), {
    teamIds: member ? arrayUnion(teamId) : arrayRemove(teamId),
  });
}
