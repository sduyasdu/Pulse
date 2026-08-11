import * as logger from "firebase-functions/logger";

// Cross-cutting conventions every function follows (Server-Functions-Spec.md §1,
// Backend-Architecture-Spec.md §A). Kept in one place so idempotency and
// loop-avoidance are applied uniformly rather than reinvented per function.

/**
 * Region for ALL functions, co-located with Firestore to avoid cross-region
 * latency and egress cost.
 *
 * Confirmed: pulse-b9d96 Firestore is the `nam5` US multi-region, whose
 * recommended co-located Cloud Functions region is `us-central1`
 * (Backend-Architecture-Spec: "region = match Firestore" — resolved).
 */
export const REGION = "us-central1";

/** Global runtime defaults applied in index.ts via setGlobalOptions. */
export const DEFAULTS = { region: REGION, maxInstances: 10 } as const;

export type Doc = Record<string, unknown> | undefined;

/** Top-level keys whose JSON representation differs between before and after. */
export function changedKeys(before: Doc, after: Doc): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) out.push(k);
  }
  return out;
}

/** True when nothing meaningful changed — drop no-op re-deliveries. */
export function isNoOp(before: Doc, after: Doc): boolean {
  return changedKeys(before, after).length === 0;
}

/**
 * True when EVERY changed key is one this function itself maintains — i.e. the
 * write was this function's own denorm/echo, not a user change. A write-triggered
 * function calls this to skip its own writes and avoid an infinite loop
 * (Server-Functions-Spec §1: idempotency / loop-avoidance). Used by SF1 (denorm)
 * and SF4 (activity) among others.
 */
export function isSelfMaintainedChange(before: Doc, after: Doc, ownedKeys: readonly string[]): boolean {
  const owned = new Set(ownedKeys);
  const changed = changedKeys(before, after);
  return changed.length > 0 && changed.every((k) => owned.has(k));
}

/** Structured info log — one place to stamp the function name. */
export function log(fn: string, msg: string, data?: Record<string, unknown>): void {
  logger.info(`[${fn}] ${msg}`, data ?? {});
}

/** Structured error log. */
export function logError(fn: string, msg: string, err: unknown, data?: Record<string, unknown>): void {
  logger.error(`[${fn}] ${msg}`, { ...(data ?? {}), error: err instanceof Error ? err.message : String(err) });
}
