import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Workspace, WorkspaceMember } from "@/types";

/**
 * Creates a personal workspace for a brand-new user and grants them
 * 'owner'. These must be two SEQUENTIAL writes, not a single writeBatch:
 * the workspaceMembers.create rule does `get()` on the workspace doc to
 * check `ownerId`, and within one batch, Firestore evaluates every
 * operation's rules against the pre-commit state — the batched workspace
 * write isn't visible to that get() yet, so the whole batch gets denied.
 * Committing the workspace doc first (and awaiting it) makes it visible
 * to the second write's rule evaluation.
 */
export async function createPersonalWorkspace(uid: string, displayName: string | null): Promise<string> {
  const workspaceRef = doc(db, "workspaces", `personal-${uid}`);
  const workspace: Workspace = {
    id: workspaceRef.id,
    name: displayName ? `${displayName}'s Workspace` : "My Workspace",
    isPersonal: true,
    ownerId: uid,
    createdAt: Date.now(),
  };
  await setDoc(workspaceRef, workspace);

  const member: WorkspaceMember = { uid, role: "owner", joinedAt: Date.now() };
  await setDoc(doc(db, "workspaces", workspaceRef.id, "workspaceMembers", uid), member);

  return workspaceRef.id;
}
