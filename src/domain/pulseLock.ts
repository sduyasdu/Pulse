import type { EditScope, Pulse } from "@/types";

// Why a Pulse is read-only, and what that does to a member's edit scope
// (Hide-and-Archive-Spec §5.1, §5.6). Pure and React-free so the precedence
// rule — which lock wins when both apply — is unit-testable in one place and
// can't drift between the banner, the toolbar and the disabled states.

/** The reason a Pulse is read-only, or null when it isn't. */
export type LockReason = "archived" | "plan" | null;

/**
 * Which lock applies, given the Pulse and whether the plan's over-limit lock
 * (Plans-Spec §5.1) covers it.
 *
 * **Archive outranks the plan lock.** Both make the Pulse read-only, but only
 * archive is something a person in the room can act on — an owner clears it with
 * one click, whereas the plan lock clears only by deleting another Pulse or
 * upgrading. Unarchiving then reveals the plan banner, which is honest: the
 * Pulse really is still locked, for a different reason.
 */
export function pulseLock(pulse: Pulse | null | undefined, planLocked: boolean): LockReason {
  if (pulse && (pulse.archivedAt ?? null) !== null) return "archived";
  if (planLocked) return "plan";
  return null;
}

/** Is this Pulse frozen by the shared archive state? */
export function isArchived(pulse: Pulse | null | undefined): boolean {
  return !!pulse && (pulse.archivedAt ?? null) !== null;
}

/**
 * A member's edit scope once the lock is applied. Every disabled state, drag
 * guard, hidden control and keyboard shortcut in the app derives from
 * `editScope`, so folding the lock in HERE freezes all of them at once — no
 * per-component work, and nothing to forget when a new control is added.
 */
export function effectiveEditScope(scope: EditScope, lock: LockReason): EditScope {
  return lock === null ? scope : "none";
}
