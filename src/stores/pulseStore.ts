import { create } from "zustand";
import type { Attachment, CostEntry, Epic, Feature, Pulse, PulseMember, PulseRole, ReadScope, Resource, ResourceRate, StatusDef, Subtask } from "@/types";
import { DEFAULT_GRAPH_CONFIG } from "@/types";
import { subscribeCosts, createCost, updateCost, deleteCost, newCostId } from "@/services/firestore/costs";
import { subscribeRates, setResourceRate, deleteResourceRate } from "@/services/firestore/rates";
import { COSTS_ENABLED } from "@/domain/flags";
import { subscribeEpics, createEpic, updateEpic, deleteEpic, newEpicId } from "@/services/firestore/epics";
import { subscribeFeatures, createFeature, updateFeature, deleteFeature, newFeatureId } from "@/services/firestore/features";
import {
  subscribeResources,
  createResource,
  updateResource,
  deleteResource,
  newResourceId,
  makeInitials,
} from "@/services/firestore/resources";
import { subscribePulse, renamePulse as renamePulseDoc, updateGraphConfig, updateResourceTypes, updatePulseStatuses } from "@/services/firestore/pulses";
import { subscribePulseMembers } from "@/services/firestore/memberships";
import { recordSingle, recordMany, patchOp, createOp, deleteOp } from "@/stores/undoStore";
import { todayIndex, toDateInputValue } from "@/domain/dateUtils";
import { capsOf } from "@/domain/permissions";
import { useAuthStore } from "@/stores/authStore";
import { rejectAttachmentUrl } from "@/domain/attachments";
import { cycleOfTask, initialStatusOf } from "@/domain/constants";
import type { TranslationKey } from "@/i18n";

/** Options accepted by the recording mutations. Pass { record: false } for
 * intermediate/streamed writes (canvas drags, bulk layout ops) that record a
 * single coalesced undo entry themselves — see Undo-Spec.md §5. */
interface MutateOpts {
  record?: boolean;
}

interface PulseStoreState {
  pulseId: string | null;
  pulse: Pulse | null;
  epics: Epic[];
  features: Feature[];
  resources: Resource[];
  costs: CostEntry[];
  /** Hourly rates — admin-only (Costs-Spec §8.3). Empty for everyone else,
   * because their listener is rejected by the rules; that's the mechanism, not a
   * fallback. */
  rates: ResourceRate[];
  members: PulseMember[];
  loading: boolean;
  notFound: boolean;
  /** Set when a live content listener is REFUSED, as opposed to returning
   * nothing. The two used to be the same value — a denied read called back with
   * `[]`, so the canvas drew an empty Pulse and said nothing was wrong. Distinct
   * from `notFound`, which is a real answer about a Pulse that isn't there. */
  contentError: string | null;
  /** The last write that failed, for the UI to surface. Reads have
   * `contentError`; writes had nothing, so a refused or oversized write
   * disappeared silently and the change simply never appeared. */
  writeError: { key: TranslationKey; ts: number } | null;
  clearWriteError: () => void;

  load: (pulseId: string) => () => void;
  roleOf: (uid: string) => PulseRole | null;

  renamePulse: (name: string) => Promise<void>;
  setGraphConfig: (stepPx: number, workPerStep: number) => Promise<void>;
  setResourceTypes: (types: string[]) => Promise<void>;
  setStatuses: (statuses: StatusDef[]) => Promise<void>;

  addEpic: (y0: number, span?: { minX: number; maxX: number }) => Promise<string>;
  patchEpic: (epicId: string, patch: Partial<Epic>, opts?: MutateOpts) => Promise<void>;
  removeEpic: (epicId: string) => Promise<void>;

  addFeature: (patch: Partial<Feature> & Pick<Feature, "x" | "y">) => Promise<string>;
  patchFeature: (featureId: string, patch: Partial<Feature>, opts?: MutateOpts) => Promise<void>;
  setFeatureStatus: (featureId: string, status: Feature["status"]) => Promise<void>;
  removeFeature: (featureId: string) => Promise<void>;
  duplicateFeature: (featureId: string) => Promise<string | null>;
  moveFeatureToEpic: (featureId: string, epicId: string | null) => Promise<void>;

  addResource: (name: string, type: string | null) => Promise<Resource>;
  patchResource: (resourceId: string, patch: Partial<Resource>) => Promise<void>;
  removeResource: (resourceId: string) => Promise<void>;
  duplicateResource: (resourceId: string) => Promise<Resource | null>;

  assignResource: (featureId: string, resourceId: string) => Promise<void>;
  unassignResource: (featureId: string, resourceId: string) => Promise<void>;
  setAlloc: (featureId: string, resourceId: string, pct: number) => Promise<void>;

  addSubtask: (featureId: string) => Promise<string>;
  patchSubtask: (featureId: string, subtaskId: string, patch: Partial<Subtask>) => Promise<void>;
  removeSubtask: (featureId: string, subtaskId: string) => Promise<void>;
  toggleSubtaskResource: (featureId: string, subtaskId: string, resourceId: string) => Promise<void>;

  addAttachment: (featureId: string, title: string, url: string) => Promise<void>;
  removeAttachment: (featureId: string, attachmentId: string) => Promise<void>;

  setRate: (resourceId: string, hourlyCost: number | null) => Promise<void>;

  addCost: (featureId: string, patch: Partial<CostEntry> & Pick<CostEntry, "typeId">) => Promise<string | null>;
  patchCost: (costId: string, patch: Partial<CostEntry>) => Promise<void>;
  removeCost: (costId: string) => Promise<void>;
}

function omit<K extends string>(obj: Record<K, number> | undefined, key: K): Record<K, number> {
  const o = { ...(obj ?? ({} as Record<K, number>)) };
  delete o[key];
  return o;
}

// A Feature/Epic/Resource is a plain JSON object as far as the undo engine is
// concerned; this cast keeps the op builders' `Record<string, unknown>` happy.
const asDoc = (o: object): Record<string, unknown> => o as Record<string, unknown>;

/**
 * Client-maintained permission denorms (Permissions-Spec §4.2, P12 =
 * client-first; the server hardening is Server-Functions-Spec SF1). Recomputes
 * `assignedUids`/`leadUid` for every feature from the current features+resources
 * and writes only the ones that drifted — a single self-healing loop that
 * covers all write paths, the `linkedUid` fan-out, undo/redo, and backfill.
 * Runs only for a full editor (rules reject others; a stale denorm fails
 * closed), and converges (a correction re-triggers it, then matches → no write).
 */
// SF1 (deployed) is now the authoritative maintainer of Feature.assignedUids /
// leadUid — including the linkedUid fan-out the client couldn't do atomically —
// so the client no longer reconciles those (it did per-snapshot over every
// feature, which was needless work on mobile). What remains client-side is the
// cost→feature scopeUids copy (Costs-Spec §7), which no server function owns yet:
// a cost snapshots its parent task's assignedUids at write time, and reassigning
// the task later leaves that copy stale, silently denying a My-Beat viewer the
// costs on their own task. Re-sync it here. Reads features[].assignedUids —
// maintained by SF1 and arriving via snapshot. Service-layer writes, so a
// reconcile never lands in undo history or the activity log.
function reconcileCostScopes(get: () => PulseStoreState) {
  const { pulseId, features, costs, members } = get();
  if (!pulseId) return;
  const uid = useAuthStore.getState().firebaseUser?.uid;
  const me = uid ? members.find((m) => m.uid === uid) : undefined;
  if (!me || capsOf(me).editScope !== "all") return;
  for (const c of costs) {
    const want = features.find((f) => f.id === c.featureId)?.assignedUids ?? [];
    const have = c.scopeUids ?? [];
    if (want.length !== have.length || want.some((u, i) => u !== have[i])) {
      void updateCost(pulseId, c.id, { scopeUids: [...want] }).catch(() => {});
    }
  }
}

/**
 * Runs a write and surfaces its failure.
 *
 * Every mutation here awaited its write and did nothing with a rejection, so a
 * refusal — lost access, an oversized document, a dropped connection — produced
 * an unhandled rejection and a change that silently never appeared. The same
 * fault the read paths were swept for (CLAUDE.md, "a swallowed onSnapshot error
 * looks exactly like an empty collection"), on the other side of the wire.
 *
 * Returns false when the write failed, so a caller that can stop does, rather
 * than recording an undo entry for something that never happened.
 */
async function write(
  set: (partial: { writeError: { key: TranslationKey; ts: number } | null }) => void,
  op: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await op();
    return true;
  } catch {
    set({ writeError: { key: "write.failed", ts: Date.now() } });
    return false;
  }
}

export const usePulseStore = create<PulseStoreState>((set, get) => ({
  pulseId: null,
  pulse: null,
  epics: [],
  features: [],
  resources: [],
  costs: [],
  rates: [],
  members: [],
  loading: true,
  notFound: false,
  contentError: null,
  writeError: null,

  clearWriteError: () => set({ writeError: null }),

  load: (pulseId) => {
    set({ pulseId, loading: true, notFound: false, contentError: null, epics: [], features: [], resources: [], costs: [], rates: [], members: [] });
    // Which listener's refusal is the one currently on screen. Only matters
    // because a *scoped* refusal is recoverable and the others are not — see
    // `applyReadScope` below.
    let errorSource: string | null = null;
    // First refusal wins: one banner naming the fault beats several racing to
    // overwrite each other, and they almost always share a cause.
    const failFrom = (source: string) => (message: string) => {
      if (get().pulseId !== pulseId || get().contentError) return;
      errorSource = source;
      set({ contentError: message, loading: false });
    };
    // `loading` means "there is nothing to paint yet", NOT "the pulse doc
    // arrived". Every listener the first paint reads reports in here, and the
    // spinner holds until all of them have.
    //
    // Two independent reasons, and dropping either one has already cost us:
    //
    // 1. `roleOf(uid)` depends on `members`, and PulsePage's self-heal check
    //    ("not a member -> stale entry, bounce to the dashboard") fires the
    //    instant `loading` clears. With the pulse doc arriving first and
    //    `members` still its initial `[]`, that check reads a false "not a
    //    member" and deletes a perfectly good myPulses entry.
    //
    // 2. The canvas draws "This Pulse is empty / add a task" from
    //    `epics.length === 0 && features.length === 0` — which is also exactly
    //    what those arrays hold before their listeners have said anything. When
    //    the gate was pulse+members only, opening a Pulse full of work flashed
    //    the empty placeholder first, because the features listener starts
    //    behind the ones subscribed synchronously below — it cannot be created
    //    until the caller's read scope is known.
    //
    // (2) is the swallowed-onError bug wearing different clothes: a read still
    // in flight rendered as a settled empty answer. Both invite someone to
    // re-create work that was already on its way.
    //
    // Nothing can leave this pending forever. Every listener delivers a first
    // snapshot — Firestore serves one from cache when it can't reach the
    // server — and a refusal clears `loading` itself. The one path that never
    // reports is a load superseded by a newer one, which has set
    // `loading: true` again and owns its own gate.
    const pending = new Set(["pulse", "members", "epics", "resources", "features"]);
    const arrived = (source: string) => {
      if (!pending.delete(source)) return; // later snapshots aren't news
      if (pending.size === 0 && get().pulseId === pulseId) set({ loading: false });
    };

    const uid = useAuthStore.getState().firebaseUser?.uid;

    /**
     * Features and costs are read-scoped (Permissions-Spec §4.3): a My-Beat
     * Viewer may only see features whose `assignedUids` contain them, and the
     * rules enforce that on the *query*, so their listener must carry the
     * `array-contains` constraint. An unconstrained one is refused wholesale.
     *
     * So these two cannot be subscribed until the caller's own role is known,
     * and that role is already in the roster snapshot — a member may list
     * `pulseMembers` (firestore.rules: `isPulseMember(pulseId)`), and their own
     * doc is always in the result. This used to spend a separate
     * `fetchMembership` getDoc on it instead, which put a full server round
     * trip in front of the two listeners that carry the Pulse's actual
     * contents, and therefore in front of the first paint.
     *
     * The cost of reading it from the roster is that the first roster snapshot
     * may be served from cache, and a cached role can be stale — someone
     * demoted to My-Beat Viewer since their last visit would issue the
     * unconstrained query and be refused. That is why the scope is re-applied
     * on every roster snapshot rather than resolved once: the server's roster
     * arrives moments later, the scope changes, and these two resubscribe with
     * the right query shape.
     *
     * A live demotion mid-session lands in exactly the same path, which the old
     * one-shot resolution never handled at all — it broke the listener with no
     * way back short of a reload.
     */
    let scopedUnsubs: (() => void)[] = [];
    let scope: ReadScope | null = null; // null = not subscribed yet

    const subscribeScoped = (next: ReadScope) => {
      scope = next;
      const beatUid = next === "beat" ? uid : undefined;
      scopedUnsubs = [
        subscribeFeatures(pulseId, (features) => {
          set({ features });
          reconcileCostScopes(get);
          arrived("features");
        }, beatUid, failFrom("features")),
        // Costs carry the same beat scoping as features (Costs-Spec §7), so they
        // ride the same resolved read scope rather than resolving it twice.
        //
        // Guarded like `rates` below, and for the reason written there: a hidden
        // panel that still streams a collection bills reads for something nobody
        // can see. It was streaming anyway, which also left its refusals with
        // nowhere honest to go — routing them to `contentError` would have
        // blocked the whole Pulse over a parked feature, and swallowing them is
        // the bug being fixed. Not subscribing answers both.
        ...(COSTS_ENABLED
          ? [subscribeCosts(pulseId, (costs) => { set({ costs }); reconcileCostScopes(get); }, beatUid, failFrom("costs"))]
          : []),
      ];
    };

    const applyReadScope = (members: PulseMember[]) => {
      const me = uid ? members.find((m) => m.uid === uid) : undefined;
      // Not in the roster reads as 'all' — the same fallback the getDoc path
      // used when it came back null. It is very nearly unreachable (our own doc
      // is always in a list we were allowed to run) and the query it produces
      // will be refused for a non-member anyway, which is the honest answer.
      // What matters is that it still resolves the gate: a spinner here would
      // outlast PulsePage's self-heal, which only runs once `loading` clears.
      const next: ReadScope = me ? capsOf(me).readScope : "all";
      if (next === scope) return;
      scopedUnsubs.forEach((u) => u());
      scopedUnsubs = [];
      // A refusal from these two was decided under a read scope we no longer
      // believe, so it is not a fault any more — it is a question we asked
      // wrongly. Clear it and let the correctly-shaped query answer. Refusals
      // from the unscoped listeners are untouched: resubscribing changes
      // nothing for them.
      if ((errorSource === "features" || errorSource === "costs") && get().pulseId === pulseId) {
        errorSource = null;
        // If features was refused before ever delivering, the gate is still
        // open and there is genuinely nothing to paint — go back to the
        // spinner rather than flashing the empty-Pulse placeholder.
        set(pending.has("features") ? { contentError: null, loading: true } : { contentError: null });
      }
      subscribeScoped(next);
    };

    const unsubs = [
      subscribePulse(pulseId, (pulse) => {
        set({ pulse, notFound: pulse === null });
        arrived("pulse");
      }, failFrom("pulse")),
      subscribeEpics(pulseId, (epics) => {
        set({ epics });
        arrived("epics");
      }, failFrom("epics")),
      subscribeResources(pulseId, (resources) => {
        set({ resources });
        arrived("resources");
      }, failFrom("resources")),
      // Parked with the rest of costing (CO21). A hidden panel that still streams
      // a collection bills reads for something nobody can see.
      ...(COSTS_ENABLED ? [subscribeRates(pulseId, (rates) => set({ rates }))] : []),
      subscribePulseMembers(pulseId, (members) => {
        set({ members });
        arrived("members");
        applyReadScope(members);
      }, failFrom("members")),
    ];
    return () => { unsubs.forEach((u) => u()); scopedUnsubs.forEach((u) => u()); };
  },

  roleOf: (uid) => get().members.find((m) => m.uid === uid)?.role ?? null,

  renamePulse: async (name) => {
    const { pulseId, pulse } = get();
    if (!pulseId) return;
    await renamePulseDoc(pulseId, name);
    if (pulse) recordSingle("Rename Beat", pulseId, patchOp("pulse", pulseId, asDoc(pulse), { name }));
  },

  setGraphConfig: async (stepPx, workPerStep) => {
    const { pulseId, pulse } = get();
    if (!pulseId) return;
    const graphConfig = { stepPx, workPerStep };
    await updateGraphConfig(pulseId, graphConfig);
    if (pulse) recordSingle("Change effort scale", pulseId, patchOp("pulse", pulseId, asDoc(pulse), { graphConfig }));
  },

  setResourceTypes: async (types) => {
    const { pulseId, pulse } = get();
    if (!pulseId) return;
    await updateResourceTypes(pulseId, types);
    if (pulse) recordSingle("Edit resource types", pulseId, patchOp("pulse", pulseId, asDoc(pulse), { resourceTypes: types }));
  },

  setStatuses: async (statuses) => {
    const { pulseId, pulse } = get();
    if (!pulseId) return;
    await updatePulseStatuses(pulseId, statuses);
    if (pulse) recordSingle("Edit statuses", pulseId, patchOp("pulse", pulseId, asDoc(pulse), { statuses }));
  },

  addEpic: async (y0, span) => {
    const { pulseId, epics } = get();
    if (!pulseId) throw new Error("no pulse loaded");
    const id = newEpicId(pulseId);
    const color = EPIC_PALETTE[epics.length % EPIC_PALETTE.length];
    // `span` gives the band a real place on the timeline. Without one an epic
    // with no features has no horizontal extent at all, and the canvas used to
    // park it at a fixed 8px from the left of the viewport — nowhere near the
    // dates being looked at, and unrelated to where the next task would land.
    // Stored as the manual bounds the model already has for a hand-widened
    // epic; the first task assigned to it widens the band from there as usual.
    const epic: Epic = {
      id,
      name: DEFAULT_EPIC_NAME,
      color,
      // Written once, never updated — the baseline `isNewEpic` compares against
      // to tell an auto-assigned colour from a chosen one.
      initialColor: color,
      y0,
      y1: y0 + 130,
      ...(span ? { manualMinX: span.minX, manualMaxX: span.maxX } : {}),
    };
    await write(set, () => createEpic(pulseId, epic));
    recordSingle("Add epic", pulseId, createOp("epic", id, asDoc(epic)));
    return id;
  },

  patchEpic: async (epicId, patch, opts) => {
    const { pulseId, epics } = get();
    if (!pulseId) return;
    const before = epics.find((e) => e.id === epicId);
    if (!(await write(set, () => updateEpic(pulseId, epicId, patch)))) return;
    if (opts?.record !== false && before) recordSingle("Edit epic", pulseId, patchOp("epic", epicId, asDoc(before), patch));
  },

  removeEpic: async (epicId) => {
    const { pulseId, epics, features } = get();
    if (!pulseId) return;
    const epic = epics.find((e) => e.id === epicId);
    const orphaned = features.filter((f) => f.epicId === epicId);
    await deleteEpic(pulseId, epicId);
    await Promise.all(orphaned.map((f) => updateFeature(pulseId, f.id, { epicId: null })));
    // One history entry: recreate the epic + restore each child's epicId.
    if (epic) {
      recordMany("Delete epic", pulseId, [
        deleteOp("epic", epicId, asDoc(epic)),
        ...orphaned.map((f) => patchOp("feature", f.id, asDoc(f), { epicId: null })),
      ]);
    }
  },

  addFeature: async (patch) => {
    const { pulseId, pulse, epics } = get();
    if (!pulseId) throw new Error("no pulse loaded");
    const id = newFeatureId(pulseId);
    // Cycles-Spec CY2: the workflow is stamped here, from the epic the task is
    // being created in, and never recomputed. Resolving it later from the
    // task's *current* epic would mean a drag across epic bands silently
    // changed its workflow.
    const epic = patch.epicId ? epics.find((e) => e.id === patch.epicId) : undefined;
    const cycle = cycleOfTask({ cycleId: epic?.cycleId ?? pulse?.defaultCycleId }, pulse);
    const feature: Feature = {
      id,
      title: "New task",
      duration: 8,
      // One unit of work per day — a new task starts as light as the graph can
      // draw it, so its height is something the planner sets rather than
      // something they have to undo.
      work: 1,
      // The first stage of its own cycle, not the literal "planned" — which is
      // only the right answer for the built-in one.
      status: initialStatusOf(cycle),
      cycleId: cycle.id,
      resources: [],
      ai: false,
      ...patch,
    };
    await write(set, () => createFeature(pulseId, feature));
    recordSingle("Add task", pulseId, createOp("feature", id, asDoc(feature)));
    return id;
  },

  patchFeature: async (featureId, patch, opts) => {
    const { pulseId, features } = get();
    if (!pulseId) return;
    const before = features.find((f) => f.id === featureId);
    if (!(await write(set, () => updateFeature(pulseId, featureId, patch)))) return;
    if (opts?.record !== false && before) recordSingle("Edit task", pulseId, patchOp("feature", featureId, asDoc(before), patch));
  },

  // Single status path shared by the details panel and the Kanban board:
  // maintains the finished date (stamp today entering "done", clear leaving it)
  // and records one undo entry carrying both fields together.
  setFeatureStatus: async (featureId, status) => {
    const { pulseId, features } = get();
    if (!pulseId) return;
    const before = features.find((f) => f.id === featureId);
    if (!before || before.status === status) return;
    const patch: Partial<Feature> = { status };
    const wasDone = before.status === "done";
    const nowDone = status === "done";
    if (nowDone && !wasDone) patch.finishedAt = toDateInputValue(todayIndex());
    else if (!nowDone && wasDone) patch.finishedAt = null;
    if (!(await write(set, () => updateFeature(pulseId, featureId, patch)))) return;
    recordSingle("Change status", pulseId, patchOp("feature", featureId, asDoc(before), patch));
  },

  removeFeature: async (featureId) => {
    const { pulseId, features, costs } = get();
    if (!pulseId) return;
    const feature = features.find((f) => f.id === featureId);
    // Costs cascade with their task (Costs-Spec §9): featureId is required, so
    // an orphan couldn't exist, and it would have no span to prorate anyway.
    // One undo op for the whole gesture, so restoring the task restores its spend.
    const doomed = costs.filter((c) => c.featureId === featureId);
    await Promise.all(doomed.map((c) => deleteCost(pulseId, c.id)));
    await deleteFeature(pulseId, featureId);
    if (!feature) return;
    const ops = [
      deleteOp("feature", featureId, asDoc(feature)),
      ...doomed.map((c) => deleteOp("cost", c.id, asDoc(c))),
    ];
    if (ops.length === 1) recordSingle("Delete task", pulseId, ops[0]);
    else recordMany("Delete task", pulseId, ops);
  },

  duplicateFeature: async (featureId) => {
    const { pulseId, features } = get();
    if (!pulseId) return null;
    const src = features.find((f) => f.id === featureId);
    if (!src) return null;
    const id = newFeatureId(pulseId);
    // Copy everything (dates, effort, assignees, subtasks, attachments, epic,
    // plan baseline) but nudge it down so it doesn't sit exactly on top of the
    // original. Subtask/attachment ids stay — they only need to be unique
    // within their own feature doc.
    const dup: Feature = { ...src, id, title: `${src.title} (copy)`, y: src.y + 36 };
    await write(set, () => createFeature(pulseId, dup));
    recordSingle("Duplicate task", pulseId, createOp("feature", id, asDoc(dup)));
    return id;
  },

  // Moves the task between epic bands. Deliberately does NOT touch `cycleId`
  // (Cycles-Spec CY2a): a drag is a scheduling gesture, and a task carries its
  // workflow with it.
  moveFeatureToEpic: async (featureId, epicId) => {
    const { pulseId, features, epics } = get();
    if (!pulseId) return;
    const before = features.find((f) => f.id === featureId);
    let patch: Partial<Feature>;
    if (!epicId) {
      patch = { epicId: null };
    } else {
      const epic = epics.find((e) => e.id === epicId);
      if (!epic) {
        patch = { epicId };
      } else {
        const others = features.filter((f) => f.id !== featureId && f.epicId === epicId);
        let ny = epic.y0 + 34;
        if (others.length) {
          // caller (UI) passes a boxHeight-aware value when precision matters;
          // a simple stacking estimate here keeps the store free of the Graph
          // Effort config dependency.
          ny = Math.max(ny, Math.max(...others.map((f) => f.y + 90)) + 12);
        }
        patch = { epicId, y: ny };
      }
    }
    if (!(await write(set, () => updateFeature(pulseId, featureId, patch)))) return;
    if (before) recordSingle("Move task to epic", pulseId, patchOp("feature", featureId, asDoc(before), patch));
  },

  addResource: async (name, type) => {
    const { pulseId, resources } = get();
    if (!pulseId) throw new Error("no pulse loaded");
    const id = newResourceId(pulseId);
    const resource: Resource = { id, initials: makeInitials(name, resources), name: name.trim(), capacity: 100, type };
    await write(set, () => createResource(pulseId, resource));
    recordSingle("Add resource", pulseId, createOp("resource", id, asDoc(resource)));
    return resource;
  },

  patchResource: async (resourceId, patch) => {
    const { pulseId, resources } = get();
    if (!pulseId) return;
    const before = resources.find((r) => r.id === resourceId);
    if (!(await write(set, () => updateResource(pulseId, resourceId, patch)))) return;
    if (before) recordSingle("Edit resource", pulseId, patchOp("resource", resourceId, asDoc(before), patch));
  },

  removeResource: async (resourceId) => {
    const { pulseId, resources, features } = get();
    if (!pulseId) return;
    const resource = resources.find((r) => r.id === resourceId);
    const ops: (ReturnType<typeof patchOp> | ReturnType<typeof deleteOp>)[] = [];
    if (resource) ops.push(deleteOp("resource", resourceId, asDoc(resource)));
    await Promise.all(
      features.map(async (f) => {
        const usesIt = (f.resources || []).includes(resourceId) || (f.children || []).some((c) => (c.resources || []).includes(resourceId));
        if (!usesIt) return;
        const patch: Partial<Feature> = {
          resources: (f.resources || []).filter((r) => r !== resourceId),
          alloc: omit(f.alloc, resourceId),
        };
        if (f.lead === resourceId) patch.lead = null;
        if (Array.isArray(f.children)) {
          patch.children = f.children.map((c) => ({
            ...c,
            resources: (c.resources || []).filter((r) => r !== resourceId),
            alloc: omit(c.alloc, resourceId),
          }));
        }
        ops.push(patchOp("feature", f.id, asDoc(f), patch));
        await updateFeature(pulseId, f.id, patch);
      }),
    );
    await deleteResource(pulseId, resourceId);
    recordMany("Delete resource", pulseId, ops);
  },

  duplicateResource: async (resourceId) => {
    const { pulseId, resources } = get();
    if (!pulseId) return null;
    const src = resources.find((r) => r.id === resourceId);
    if (!src) return null;
    const id = newResourceId(pulseId);
    const name = `${src.name} (copy)`;
    // Copy name/type/capacity, mint fresh de-duplicated initials, and a new id.
    // linkedUid is deliberately NOT copied — an account link is 1:1.
    const resource: Resource = { id, initials: makeInitials(name, resources), name, capacity: src.capacity, type: src.type };
    await write(set, () => createResource(pulseId, resource));
    recordSingle("Duplicate resource", pulseId, createOp("resource", id, asDoc(resource)));
    return resource;
  },

  assignResource: async (featureId, resourceId) => {
    const { pulseId, features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!pulseId || !feature || (feature.resources || []).includes(resourceId)) return;
    const patch: Partial<Feature> = {
      resources: [...(feature.resources || []), resourceId],
      alloc: { ...(feature.alloc || {}), [resourceId]: 100 },
    };
    if (!(await write(set, () => updateFeature(pulseId, featureId, patch)))) return;
    recordSingle("Assign resource", pulseId, patchOp("feature", featureId, asDoc(feature), patch));
  },

  unassignResource: async (featureId, resourceId) => {
    const { pulseId, features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!pulseId || !feature) return;
    const patch: Partial<Feature> = {
      resources: (feature.resources || []).filter((r) => r !== resourceId),
      alloc: omit(feature.alloc, resourceId),
    };
    // Only touch `lead` when this resource actually was the lead. Writing
    // `lead: feature.lead` unconditionally passed `undefined` whenever no
    // leader was set, which Firestore rejects outright — taking the whole
    // write down with it.
    if (feature.lead === resourceId) patch.lead = null;
    if (!(await write(set, () => updateFeature(pulseId, featureId, patch)))) return;
    recordSingle("Unassign resource", pulseId, patchOp("feature", featureId, asDoc(feature), patch));
  },

  setAlloc: async (featureId, resourceId, pct) => {
    const { pulseId, features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!pulseId || !feature) return;
    const patch: Partial<Feature> = { alloc: { ...(feature.alloc || {}), [resourceId]: pct } };
    if (!(await write(set, () => updateFeature(pulseId, featureId, patch)))) return;
    recordSingle("Change allocation", pulseId, patchOp("feature", featureId, asDoc(feature), patch));
  },

  addSubtask: async (featureId) => {
    const { pulseId, features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!pulseId || !feature) throw new Error("feature not found");
    const id = `st-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    // CY10: a subtask inherits its parent's cycle and is not separately
    // assignable, so it starts in that cycle's first stage.
    const subtask: Subtask = {
      id,
      title: "New subtask",
      status: initialStatusOf(cycleOfTask(feature, get().pulse)),
      resources: [],
      createdAt: toDateInputValue(todayIndex()),
    };
    const patch: Partial<Feature> = { collapsed: false, children: [...(feature.children || []), subtask] };
    // Reports rather than returns: the signature owes the caller an id, and the
    // caller uses it to focus the new row. A failed write leaves nothing to
    // focus, which is harmless — the toast is what carries the news.
    await write(set, () => updateFeature(pulseId, featureId, patch));
    recordSingle("Add subtask", pulseId, patchOp("feature", featureId, asDoc(feature), patch));
    return id;
  },

  patchSubtask: async (featureId, subtaskId, patch) => {
    const { pulseId, features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!pulseId || !feature) return;
    const featurePatch: Partial<Feature> = {
      children: (feature.children || []).map((c) => (c.id === subtaskId ? { ...c, ...patch } : c)),
    };
    if (!(await write(set, () => updateFeature(pulseId, featureId, featurePatch)))) return;
    recordSingle("Edit subtask", pulseId, patchOp("feature", featureId, asDoc(feature), featurePatch));
  },

  removeSubtask: async (featureId, subtaskId) => {
    const { pulseId, features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!pulseId || !feature) return;
    const patch: Partial<Feature> = { children: (feature.children || []).filter((c) => c.id !== subtaskId) };
    if (!(await write(set, () => updateFeature(pulseId, featureId, patch)))) return;
    recordSingle("Remove subtask", pulseId, patchOp("feature", featureId, asDoc(feature), patch));
  },

  toggleSubtaskResource: async (featureId, subtaskId, resourceId) => {
    const { pulseId, features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!pulseId || !feature) return;
    const children = (feature.children || []).map((c) => {
      if (c.id !== subtaskId) return c;
      const has = (c.resources || []).includes(resourceId);
      return { ...c, resources: has ? c.resources.filter((r) => r !== resourceId) : [...(c.resources || []), resourceId] };
    });
    const patch: Partial<Feature> = { children };
    if (!(await write(set, () => updateFeature(pulseId, featureId, patch)))) return;
    recordSingle("Edit subtask assignees", pulseId, patchOp("feature", featureId, asDoc(feature), patch));
  },

  addAttachment: async (featureId, title, url) => {
    const { pulseId, features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!pulseId || !feature) return;
    const raw = url.trim();
    if (!raw) return;
    const isData = /^data:/i.test(raw);
    const finalUrl = isData ? raw : /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    // Checked once the scheme is settled, because that is the string stored.
    const rejection = rejectAttachmentUrl(finalUrl);
    if (rejection) {
      set({ writeError: { key: `attach.${rejection}` as TranslationKey, ts: Date.now() } });
      return;
    }
    const attachment: Attachment = {
      id: `at-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      title: (title || raw).trim().slice(0, 120),
      url: finalUrl,
      isData,
    };
    const patch: Partial<Feature> = { attachments: [...(feature.attachments || []), attachment] };
    if (!(await write(set, () => updateFeature(pulseId, featureId, patch)))) return;
    recordSingle("Add attachment", pulseId, patchOp("feature", featureId, asDoc(feature), patch));
  },

  removeAttachment: async (featureId, attachmentId) => {
    const { pulseId, features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!pulseId || !feature) return;
    const patch: Partial<Feature> = { attachments: (feature.attachments || []).filter((a) => a.id !== attachmentId) };
    if (!(await write(set, () => updateFeature(pulseId, featureId, patch)))) return;
    recordSingle("Remove attachment", pulseId, patchOp("feature", featureId, asDoc(feature), patch));
  },

  // ---- rates (Costs-Spec §8.3) --------------------------------------------

  /**
   * Set or clear a resource's hourly cost. Null clears it, which removes that
   * person's labour rows entirely rather than zeroing them (§8.8).
   *
   * Deliberately NOT recorded in undo or the activity log: the log is
   * member-readable, so a rate delta in it would defeat the admin-only rule the
   * rates collection exists to enforce (§8.7 / CO18).
   */
  setRate: async (resourceId, hourlyCost) => {
    const { pulseId } = get();
    const uid = useAuthStore.getState().firebaseUser?.uid;
    if (!pulseId || !uid) return;
    if (hourlyCost == null || !(hourlyCost > 0)) {
      await deleteResourceRate(pulseId, resourceId);
      return;
    }
    await setResourceRate(pulseId, {
      resourceId,
      hourlyCost,
      currency: "USD",
      updatedAt: Date.now(),
      updatedBy: uid,
    });
  },

  // ---- costs (Costs-Spec.md) ----------------------------------------------

  addCost: async (featureId, patch) => {
    const { pulseId, features } = get();
    const uid = useAuthStore.getState().firebaseUser?.uid;
    if (!pulseId || !uid) return null;
    const id = newCostId(pulseId);
    const cost: CostEntry = {
      id,
      featureId,
      quantities: {},
      basis: "amount",
      amountMicros: 0,
      currency: "USD",
      attrs: {},
      createdBy: uid,
      createdAt: Date.now(),
      // Scoped by the parent task, so a My-Beat viewer on that task can read it.
      scopeUids: [...(features.find((f) => f.id === featureId)?.assignedUids ?? [])],
      ...patch,
    };
    await createCost(pulseId, cost);
    recordSingle("Add cost", pulseId, createOp("cost", id, asDoc(cost)));
    return id;
  },

  patchCost: async (costId, patch) => {
    const { pulseId, costs } = get();
    if (!pulseId) return;
    const before = costs.find((c) => c.id === costId);
    await updateCost(pulseId, costId, patch);
    if (before) recordSingle("Edit cost", pulseId, patchOp("cost", costId, asDoc(before), patch));
  },

  removeCost: async (costId) => {
    const { pulseId, costs } = get();
    if (!pulseId) return;
    const cost = costs.find((c) => c.id === costId);
    await deleteCost(pulseId, costId);
    if (cost) recordSingle("Delete cost", pulseId, deleteOp("cost", costId, asDoc(cost)));
  },
}));

/** The colours a new epic cycles through, and the palette the Epics tab offers
 * when recolouring one. Exported so the two cannot drift into different sets. */
export const EPIC_PALETTE = [
  "#8B5CF6", // violet
  "#6366F1", // indigo
  "#3B82F6", // blue
  "#0EA5E9", // sky
  "#06B6D4", // cyan
  "#14B8A6", // teal
  "#10B981", // emerald
  "#22C55E", // green
  "#84CC16", // lime
  "#F59E0B", // amber
  "#F97316", // orange
  "#EF4444", // red
  "#F43F5E", // rose
  "#EC4899", // pink
  "#D946EF", // fuchsia
  "#64748B", // slate
];

/** The name a new epic is created with. Exported because the canvas treats it
 * as "not named yet" — it is a placeholder the product wrote, not a name the
 * user chose, so an epic still carrying it is unfinished. */
export const DEFAULT_EPIC_NAME = "New epic";

export const graphConfigOf = (pulse: Pulse | null) => pulse?.graphConfig ?? DEFAULT_GRAPH_CONFIG;
