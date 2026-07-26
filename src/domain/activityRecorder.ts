import type { ActivityDelta, ActivityEntityKind, ActivityEntry, ActivityVerb } from "@/types";
import type { DocKind, DocOp, UndoCommand } from "@/stores/undoStore";
import { setActivitySink } from "@/stores/undoStore";
import { useAuthStore } from "@/stores/authStore";
import { usePulseStore } from "@/stores/pulseStore";
import { logActivity, newActivityId } from "@/services/firestore/activity";
import { statusesOf } from "./constants";

// Translates an undo-engine command (Undo-Spec DocOp) into one durable activity
// entry (Changelog-Spec.md §4.4) and appends it. Installed once at app start via
// `installActivityRecorder()`, which registers the sink undoStore calls on every
// first-hand action. Kept out of undoStore itself to avoid an import cycle.

// Gestures that only move/lay-out a box or maintain a denorm aren't "changes"
// worth logging (Changelog-Spec §4.4 / CL8). A command whose every op only
// touches these keys is dropped.
const COSMETIC_KEYS = new Set([
  "y", "manualY0", "manualY1", "manualMinX", "manualMaxX", "collapsed",
  "assignedUids", "leadUid", // permission denorms (client-maintained; not user edits)
]);

// Keys whose before→after we surface as a curated delta on the entry.
const DELTA_KEYS = new Set([
  "title", "name", "status", "duration", "x", "work", "lead", "epicId",
  "initials", "capacity", "type", "finishedAt",
]);

const KIND_TO_ENTITY: Record<DocKind, ActivityEntityKind> = {
  feature: "feature", epic: "epic", resource: "resource", pulse: "pulse",
};

function isCosmetic(op: DocOp): boolean {
  return op.op === "patch" && op.keys.every((k) => COSMETIC_KEYS.has(k));
}

/** Human name of the entity at write time (rename/delete-proof — Changelog §3). */
function entityNameOf(kind: DocKind, id: string, op: DocOp): string {
  const doc = op.op === "patch" ? op.after : op.doc;
  const { pulse, features, epics, resources } = usePulseStore.getState();
  const named = (v: unknown, fallback: string) => (typeof v === "string" && v ? v : fallback);
  switch (kind) {
    case "feature":
      return named(features.find((f) => f.id === id)?.title ?? doc.title, "a task");
    case "epic":
      return named(epics.find((e) => e.id === id)?.name ?? doc.name, "an epic");
    case "resource":
      return named(resources.find((r) => r.id === id)?.name ?? doc.name, "a resource");
    case "pulse":
      return named(pulse?.name ?? doc.name, "the Pulse");
  }
}

/** Display string for a delta value: status ids and resource ids resolve to
 * their human labels; everything else stringifies. */
function displayValue(key: string, value: unknown): string | null {
  if (value == null || value === "") return null;
  const { pulse, resources, epics } = usePulseStore.getState();
  if (key === "status") return statusesOf(pulse).find((s) => s.id === value)?.label ?? String(value);
  if (key === "lead") return resources.find((r) => r.id === value)?.name ?? String(value);
  if (key === "epicId") return epics.find((e) => e.id === value)?.name ?? String(value);
  if (typeof value === "object") return null; // skip arrays/maps (resources[], alloc)
  return String(value);
}

/** Pick the most specific verb the command represents (Changelog §3 verbs). */
function verbOf(kind: DocKind, op: DocOp): ActivityVerb {
  if (op.op === "create") return "create";
  if (op.op === "delete") return "delete";
  const keys = op.keys.filter((k) => !COSMETIC_KEYS.has(k));
  if (kind === "feature") {
    if (keys.length === 1 && keys[0] === "status") return "status";
    if (keys.includes("lead")) return "lead";
    if (keys.includes("epicId")) return "move-epic";
    if (keys.includes("resources") || keys.includes("alloc")) return "assign";
    if (keys.includes("children")) return "subtask";
  }
  if (kind === "resource" && keys.includes("linkedUid")) {
    return op.after.linkedUid ? "link" : "unlink";
  }
  if (kind === "pulse") {
    if (keys.length === 1 && keys[0] === "name") return "rename";
    return "config";
  }
  if ((kind === "feature" || kind === "epic") && keys.includes("name")) return "rename";
  return "edit";
}

function deltasOf(ops: DocOp[]): ActivityDelta[] {
  const out: ActivityDelta[] = [];
  for (const op of ops) {
    if (op.op !== "patch") continue;
    for (const k of op.keys) {
      if (!DELTA_KEYS.has(k)) continue;
      const before = displayValue(k, op.before[k]);
      const after = displayValue(k, op.after[k]);
      if (before !== after) out.push({ key: k, before, after });
    }
  }
  return out;
}

function resourceName(id: string): string {
  return usePulseStore.getState().resources.find((r) => r.id === id)?.name ?? id;
}

/** Every resource id a feature doc references, directly or through a subtask. */
function allResourceIds(doc: Record<string, unknown>): string[] {
  const direct = Array.isArray(doc.resources) ? (doc.resources as string[]) : [];
  const children = Array.isArray(doc.children) ? (doc.children as { resources?: string[] }[]) : [];
  return [...direct, ...children.flatMap((c) => c.resources ?? [])];
}

/** Named who-was-added / who-was-removed deltas for assignment changes, so the
 * log reads "assigned Alice" rather than an opaque array edit. */
function assignmentDeltas(ops: DocOp[]): ActivityDelta[] {
  const out: ActivityDelta[] = [];
  for (const op of ops) {
    if (op.op !== "patch") continue;
    if (!op.keys.includes("resources") && !op.keys.includes("children")) continue;
    const before = new Set(allResourceIds(op.before));
    const after = new Set(allResourceIds(op.after));
    for (const id of after) if (!before.has(id)) out.push({ key: "assigned", before: null, after: resourceName(id) });
    for (const id of before) if (!after.has(id)) out.push({ key: "unassigned", before: resourceName(id), after: null });
  }
  return out;
}

/** assignedUids of a feature at write time — drives the My-Beat read scope.
 * Only feature entries carry it (§5.2); absent elsewhere hides them from beat
 * viewers, which is the intended admin/whole-Pulse visibility rule (CL5). */
function scopeUidsFor(kind: DocKind, id: string, op: DocOp): string[] | undefined {
  if (kind !== "feature") return undefined;
  const fromStore = usePulseStore.getState().features.find((f) => f.id === id)?.assignedUids;
  const doc = op.op === "patch" ? op.after : op.doc;
  const uids = fromStore ?? (Array.isArray(doc.assignedUids) ? (doc.assignedUids as string[]) : []);
  return [...uids];
}

function buildEntry(cmd: UndoCommand): ActivityEntry | null {
  if (cmd.ops.every(isCosmetic)) return null; // layout/denorm-only gesture
  const meaningful = cmd.ops.filter((o) => !isCosmetic(o));
  const primary = meaningful[0];
  const { firebaseUser, userDoc } = useAuthStore.getState();
  if (!firebaseUser) return null; // can't attribute → don't log

  const kind = primary.kind;
  const deltas = [...deltasOf(meaningful), ...(kind === "feature" ? assignmentDeltas(meaningful) : [])];
  const changedKeys = [...new Set(deltas.map((d) => d.key))];

  return {
    id: newActivityId(cmd.pulseId),
    actorUid: firebaseUser.uid,
    actorEmail: firebaseUser.email ?? "",
    actorName: userDoc?.displayName ?? firebaseUser.displayName ?? null,
    at: cmd.ts,
    entityKind: KIND_TO_ENTITY[kind],
    entityId: primary.id,
    entityName: entityNameOf(kind, primary.id, primary),
    verb: verbOf(kind, primary),
    summary: cmd.label,
    changedKeys: changedKeys.length ? changedKeys : undefined,
    deltas: deltas.length ? deltas : undefined,
    scopeUids: scopeUidsFor(kind, primary.id, primary),
    source: "client",
    clientKey: `${cmd.ts}:${primary.id}:${verbOf(kind, primary)}`,
  };
}

/**
 * Log an event that doesn't flow through the undo engine — membership changes,
 * joins/leaves, invite links (Changelog-Spec §3, member/invite verbs). The
 * caller is the actor. Entries carry no `scopeUids`, so they're whole-Pulse
 * visibility only (hidden from My-Beat Viewers — CL5).
 */
export function logDirectActivity(
  pulseId: string,
  params: {
    entityKind: ActivityEntityKind;
    entityId: string;
    entityName: string;
    verb: ActivityVerb;
    summary: string;
    deltas?: ActivityDelta[];
  },
): void {
  const { firebaseUser, userDoc } = useAuthStore.getState();
  if (!firebaseUser) return;
  const at = Date.now();
  void logActivity(pulseId, {
    id: newActivityId(pulseId),
    actorUid: firebaseUser.uid,
    actorEmail: firebaseUser.email ?? "",
    actorName: userDoc?.displayName ?? firebaseUser.displayName ?? null,
    at,
    entityKind: params.entityKind,
    entityId: params.entityId,
    entityName: params.entityName,
    verb: params.verb,
    summary: params.summary,
    deltas: params.deltas?.length ? params.deltas : undefined,
    source: "client",
    clientKey: `${at}:${params.entityId}:${params.verb}`,
  }).catch(() => {});
}

/** Register the recorder as undoStore's activity sink. Call once at startup. */
export function installActivityRecorder(): void {
  setActivitySink((cmd) => {
    const pulseId = cmd.pulseId;
    const entry = buildEntry(cmd);
    if (entry) void logActivity(pulseId, entry).catch(() => {});
  });
}
