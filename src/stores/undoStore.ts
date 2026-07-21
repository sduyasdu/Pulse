import { create } from "zustand";
import type { Epic, Feature, Resource } from "@/types";
import { createFeature, updateFeature, deleteFeature } from "@/services/firestore/features";
import { createEpic, updateEpic, deleteEpic } from "@/services/firestore/epics";
import { createResource, updateResource, deleteResource } from "@/services/firestore/resources";
import { patchPulse } from "@/services/firestore/pulses";

// See Undo-Spec.md. Undo is an inverse-command stack: each logical action
// records a field-level diff (D1) of every doc it touched, and undo/redo
// re-issue writes through the normal Firestore path, which echo back via the
// pulseStore's onSnapshot listeners exactly like a first-hand edit.

export type DocKind = "feature" | "epic" | "resource" | "pulse";

type Doc = Record<string, unknown>;

export type DocOp =
  | { kind: DocKind; id: string; op: "create"; doc: Doc }
  | { kind: DocKind; id: string; op: "delete"; doc: Doc }
  | { kind: DocKind; id: string; op: "patch"; keys: string[]; before: Doc; after: Doc };

export interface UndoCommand {
  label: string;
  pulseId: string;
  ops: DocOp[];
  ts: number;
}

const MAX_HISTORY = 50; // D2

// ---- op builders ---------------------------------------------------------

/** Reads `keys` off a source doc. A key the source lacks maps to `null`, not
 * `undefined` — writing `undefined` back is a no-op (stripUndefined), whereas
 * a field the action *added* must be actively cleared on undo, and the store's
 * convention for a cleared optional is `null` (see services/firestore/patch). */
function pick(source: Doc | undefined, keys: string[]): Doc {
  const out: Doc = {};
  for (const k of keys) out[k] = source && k in source ? source[k] : null;
  return out;
}

/** Build a patch op, or null when the patch changes nothing (avoids empty
 * history entries). before/after are compared structurally. */
export function patchOp(kind: DocKind, id: string, beforeDoc: Doc, patch: Doc): DocOp | null {
  const keys = Object.keys(patch);
  if (keys.length === 0) return null;
  const before = pick(beforeDoc, keys);
  const after: Doc = {};
  for (const k of keys) after[k] = patch[k];
  if (keys.every((k) => JSON.stringify(before[k]) === JSON.stringify(after[k]))) return null;
  return { kind, id, op: "patch", keys, before, after };
}

export function createOp(kind: DocKind, id: string, doc: Doc): DocOp {
  return { kind, id, op: "create", doc: { ...doc } };
}

export function deleteOp(kind: DocKind, id: string, doc: Doc): DocOp {
  return { kind, id, op: "delete", doc: { ...doc } };
}

// ---- writers -------------------------------------------------------------

async function write(pulseId: string, kind: DocKind, action: "create" | "delete" | "patch", id: string, payload: Doc): Promise<void> {
  switch (kind) {
    case "feature":
      if (action === "create") return createFeature(pulseId, payload as unknown as Feature);
      if (action === "delete") return deleteFeature(pulseId, id);
      return updateFeature(pulseId, id, payload as Partial<Feature>);
    case "epic":
      if (action === "create") return createEpic(pulseId, payload as unknown as Epic);
      if (action === "delete") return deleteEpic(pulseId, id);
      return updateEpic(pulseId, id, payload as Partial<Epic>);
    case "resource":
      if (action === "create") return createResource(pulseId, payload as unknown as Resource);
      if (action === "delete") return deleteResource(pulseId, id);
      return updateResource(pulseId, id, payload as Partial<Resource>);
    case "pulse":
      // The pulse doc is never created/deleted through undo — only patched.
      return patchPulse(pulseId, payload);
  }
}

async function applyOp(pulseId: string, op: DocOp, direction: "undo" | "redo"): Promise<void> {
  if (op.op === "patch") {
    return write(pulseId, op.kind, "patch", op.id, direction === "undo" ? op.before : op.after);
  }
  // create/delete: redo repeats the original action, undo inverts it.
  const action = direction === "redo" ? op.op : op.op === "create" ? "delete" : "create";
  return write(pulseId, op.kind, action, op.id, op.doc);
}

/** Apply every op in a command; returns how many ops failed (e.g. patch on a
 * doc a teammate deleted — §6). Undo walks ops in reverse so a compound
 * action unwinds in the opposite order it was applied. */
async function applyCommand(cmd: UndoCommand, direction: "undo" | "redo"): Promise<number> {
  const ops = direction === "undo" ? [...cmd.ops].reverse() : cmd.ops;
  let failures = 0;
  for (const op of ops) {
    try {
      await applyOp(cmd.pulseId, op, direction);
    } catch {
      failures += 1;
    }
  }
  return failures;
}

// ---- store ---------------------------------------------------------------

interface UndoState {
  pulseId: string | null;
  past: UndoCommand[];
  future: UndoCommand[];
  busy: boolean;
  toast: { text: string; ts: number } | null;
  record: (cmd: UndoCommand) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clearToast: () => void;
  reset: (pulseId: string | null) => void;
}

export const useUndoStore = create<UndoState>((set, get) => ({
  pulseId: null,
  past: [],
  future: [],
  busy: false,
  toast: null,

  record: (cmd) => {
    if (cmd.ops.length === 0) return;
    const { pulseId, past } = get();
    // Any new action clears the redo stack. Switching Pulse drops history.
    const base = pulseId === cmd.pulseId ? past : [];
    set({ pulseId: cmd.pulseId, past: [...base, cmd].slice(-MAX_HISTORY), future: [] });
  },

  undo: async () => {
    const { past, future, busy } = get();
    if (busy || past.length === 0) return;
    const cmd = past[past.length - 1];
    set({ busy: true, past: past.slice(0, -1) });
    const failures = await applyCommand(cmd, "undo");
    set({
      busy: false,
      future: [...future, cmd].slice(-MAX_HISTORY),
      toast: { text: failures ? `Undid ${cmd.label} — some items had changed` : `Undid: ${cmd.label}`, ts: Date.now() },
    });
  },

  redo: async () => {
    const { past, future, busy } = get();
    if (busy || future.length === 0) return;
    const cmd = future[future.length - 1];
    set({ busy: true, future: future.slice(0, -1) });
    const failures = await applyCommand(cmd, "redo");
    set({
      busy: false,
      past: [...past, cmd].slice(-MAX_HISTORY),
      toast: { text: failures ? `Redid ${cmd.label} — some items had changed` : `Redid: ${cmd.label}`, ts: Date.now() },
    });
  },

  clearToast: () => set({ toast: null }),

  reset: (pulseId) => set({ pulseId, past: [], future: [], toast: null, busy: false }),
}));

// ---- convenience recorders called by pulseStore mutations ----------------

export function recordSingle(label: string, pulseId: string, op: DocOp | null): void {
  if (op) useUndoStore.getState().record({ label, pulseId, ops: [op], ts: Date.now() });
}

export function recordMany(label: string, pulseId: string, ops: (DocOp | null)[]): void {
  const real = ops.filter((o): o is DocOp => o !== null);
  if (real.length) useUndoStore.getState().record({ label, pulseId, ops: real, ts: Date.now() });
}
