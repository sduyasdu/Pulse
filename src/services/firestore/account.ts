import { httpsCallable, type HttpsCallableResult } from "firebase/functions";
import { functions } from "@/lib/firebase";

/** A Beat the caller solely owns that still has other people in it. */
export interface DeletionBlocker {
  beatId: string;
  name: string;
  otherMembers: number;
}

export interface DeletionPreview {
  deletes: { beatId: string; name: string }[];
  leaves: { beatId: string; name: string }[];
  blockers: DeletionBlocker[];
  subscription: { orgId: string; status: string } | null;
  canDelete: boolean;
}

/**
 * What deleting this account would do, before anything is done.
 *
 * Server-side rather than computed here, for the same reason the deletion is:
 * the client cannot read membership across Beats it is not in, and cannot see
 * whether it is the sole owner of one without reading every member. The preview
 * and the deletion call the same audit, so the confirmation screen cannot
 * describe consequences that differ from the ones that follow.
 */
export async function previewAccountDeletion(): Promise<DeletionPreview> {
  const call = httpsCallable<void, DeletionPreview>(functions, "previewAccountDeletion");
  const { data } = await call();
  return data;
}

/** Distinguishes "you must act first" from "it broke", which need different UI. */
export type DeleteAccountOutcome =
  | { ok: true; beatsDeleted: number; beatsLeft: number }
  | { ok: false; reason: "reauth-required" }
  | { ok: false; reason: "sole-owner-beats"; blockers: DeletionBlocker[] }
  | { ok: false; reason: "active-subscription" }
  | { ok: false; reason: "partial" }
  | { ok: false; reason: "failed" };

/**
 * Deletes the account. The identity goes last, so a failure part-way leaves a
 * signed-in user who can retry rather than orphaned data nobody can reach.
 *
 * The precondition codes come back as the callable's `message`, because
 * `HttpsError` carries a machine-readable code only in `code` (always
 * `functions/failed-precondition` here) — the distinguishing string is what the
 * server put in the message.
 */
export async function deleteAccount(): Promise<DeleteAccountOutcome> {
  const call = httpsCallable<void, { deleted: boolean; beatsDeleted: number; beatsLeft: number }>(
    functions,
    "deleteAccount",
  );
  try {
    const { data }: HttpsCallableResult<{ deleted: boolean; beatsDeleted: number; beatsLeft: number }> = await call();
    return { ok: true, beatsDeleted: data.beatsDeleted, beatsLeft: data.beatsLeft };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const details = (err as { details?: { beats?: DeletionBlocker[] } } | undefined)?.details;
    if (message.includes("reauth-required")) return { ok: false, reason: "reauth-required" };
    if (message.includes("sole-owner-beats")) {
      return { ok: false, reason: "sole-owner-beats", blockers: details?.beats ?? [] };
    }
    if (message.includes("active-subscription")) return { ok: false, reason: "active-subscription" };
    if (message.includes("partial")) return { ok: false, reason: "partial" };
    return { ok: false, reason: "failed" };
  }
}
