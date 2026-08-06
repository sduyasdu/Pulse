import { create } from "zustand";
import type { Attachment, CostEntry, Epic, Feature, Pulse, PulseMember, PulseRole, Resource, ResourceRate, StatusDef, Subtask } from "@/types";
import { DEFAULT_GRAPH_CONFIG } from "@/types";
import { subscribeCosts, createCost, updateCost, deleteCost, newCostId } from "@/services/firestore/costs";
import { subscribeRates, setResourceRate, deleteResourceRate } from "@/services/firestore/rates";
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
import { subscribePulseMembers, fetchMembership } from "@/services/firestore/memberships";
import { recordSingle, recordMany, patchOp, createOp, deleteOp } from "@/stores/undoStore";
import { todayIndex, toDateInputValue } from "@/domain/dateUtils";
import { capsOf } from "@/domain/permissions";
import { useAuthStore } from "@/stores/authStore";

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

  load: (pulseId: string) => () => void;
  roleOf: (uid: string) => PulseRole | null;

  renamePulse: (name: string) => Promise<void>;
  setGraphConfig: (stepPx: number, workPerStep: number) => Promise<void>;
  setResourceTypes: (types: string[]) => Promise<void>;
  setStatuses: (statuses: StatusDef[]) => Promise<void>;

  addEpic: (y0: number) => Promise<string>;
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

  load: (pulseId) => {
    set({ pulseId, loading: true, notFound: false, epics: [], features: [], resources: [], costs: [], rates: [], members: [] });
    // `loading` must not go false until BOTH the pulse doc and the
    // pulseMembers roster have delivered their first snapshot — these are
    // two independent onSnapshot listeners with no ordering guarantee.
    // roleOf(uid) depends on `members`, and PulsePage's self-heal check
    // ("not a member -> stale, bounce to dashboard") fires the instant
    // `loading` goes false; if the pulse doc snapshot arrived first while
    // `members` was still its initial empty array, that check would see a
    // false "not a member" and delete a perfectly valid myPulses entry.
    let pulseArrived = false;
    let membersArrived = false;
    const maybeFinishLoading = () => {
      if (pulseArrived && membersArrived) set({ loading: false });
    };
    const unsubs = [
      subscribePulse(pulseId, (pulse) => {
        pulseArrived = true;
        set({ pulse, notFound: pulse === null });
        maybeFinishLoading();
      }),
      subscribeEpics(pulseId, (epics) => set({ epics })),
      subscribeResources(pulseId, (resources) => set({ resources })),
      subscribeRates(pulseId, (rates) => set({ rates })),
      subscribePulseMembers(pulseId, (members) => {
        membersArrived = true;
        set({ members });
        maybeFinishLoading();
      }),
    ];
    // Features are scoped for a My-Beat Viewer (Permissions-Spec §4.3): the rules
    // require the array-contains query, so resolve the caller's own read scope
    // (their membership doc is always self-readable) before subscribing.
    let featuresUnsub = () => {};
    let costsUnsub = () => {};
    const uid = useAuthStore.getState().firebaseUser?.uid;
    void (async () => {
      let beatUid: string | undefined;
      if (uid) {
        const me = await fetchMembership(pulseId, uid).catch(() => null);
        if (me && capsOf(me).readScope === "beat") beatUid = uid;
      }
      if (get().pulseId !== pulseId) return; // a newer load() superseded this one
      featuresUnsub = subscribeFeatures(pulseId, (features) => { set({ features }); reconcileCostScopes(get); }, beatUid);
      // Costs carry the same beat scoping as features (Costs-Spec §7), so they
      // ride the same resolved read scope rather than resolving it twice.
      costsUnsub = subscribeCosts(pulseId, (costs) => { set({ costs }); reconcileCostScopes(get); }, beatUid);
    })();
    return () => { unsubs.forEach((u) => u()); featuresUnsub(); costsUnsub(); };
  },

  roleOf: (uid) => get().members.find((m) => m.uid === uid)?.role ?? null,

  renamePulse: async (name) => {
    const { pulseId, pulse } = get();
    if (!pulseId) return;
    await renamePulseDoc(pulseId, name);
    if (pulse) recordSingle("Rename Pulse", pulseId, patchOp("pulse", pulseId, asDoc(pulse), { name }));
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

  addEpic: async (y0) => {
    const { pulseId, epics } = get();
    if (!pulseId) throw new Error("no pulse loaded");
    const id = newEpicId(pulseId);
    const EPIC_PALETTE = ["#8B5CF6", "#3B82F6", "#14B8A6", "#22C55E", "#F59E0B", "#F43F5E", "#0EA5E9"];
    const epic: Epic = { id, name: "New epic", color: EPIC_PALETTE[epics.length % EPIC_PALETTE.length], y0, y1: y0 + 130 };
    await createEpic(pulseId, epic);
    recordSingle("Add epic", pulseId, createOp("epic", id, asDoc(epic)));
    return id;
  },

  patchEpic: async (epicId, patch, opts) => {
    const { pulseId, epics } = get();
    if (!pulseId) return;
    const before = epics.find((e) => e.id === epicId);
    await updateEpic(pulseId, epicId, patch);
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
    const { pulseId } = get();
    if (!pulseId) throw new Error("no pulse loaded");
    const id = newFeatureId(pulseId);
    const feature: Feature = {
      id,
      title: "New task",
      duration: 8,
      work: 2,
      status: "planned",
      resources: [],
      ai: false,
      ...patch,
    };
    await createFeature(pulseId, feature);
    recordSingle("Add task", pulseId, createOp("feature", id, asDoc(feature)));
    return id;
  },

  patchFeature: async (featureId, patch, opts) => {
    const { pulseId, features } = get();
    if (!pulseId) return;
    const before = features.find((f) => f.id === featureId);
    await updateFeature(pulseId, featureId, patch);
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
    await updateFeature(pulseId, featureId, patch);
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
    await createFeature(pulseId, dup);
    recordSingle("Duplicate task", pulseId, createOp("feature", id, asDoc(dup)));
    return id;
  },

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
    await updateFeature(pulseId, featureId, patch);
    if (before) recordSingle("Move task to epic", pulseId, patchOp("feature", featureId, asDoc(before), patch));
  },

  addResource: async (name, type) => {
    const { pulseId, resources } = get();
    if (!pulseId) throw new Error("no pulse loaded");
    const id = newResourceId(pulseId);
    const resource: Resource = { id, initials: makeInitials(name, resources), name: name.trim(), capacity: 100, type };
    await createResource(pulseId, resource);
    recordSingle("Add resource", pulseId, createOp("resource", id, asDoc(resource)));
    return resource;
  },

  patchResource: async (resourceId, patch) => {
    const { pulseId, resources } = get();
    if (!pulseId) return;
    const before = resources.find((r) => r.id === resourceId);
    await updateResource(pulseId, resourceId, patch);
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
    await createResource(pulseId, resource);
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
    await updateFeature(pulseId, featureId, patch);
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
    await updateFeature(pulseId, featureId, patch);
    recordSingle("Unassign resource", pulseId, patchOp("feature", featureId, asDoc(feature), patch));
  },

  setAlloc: async (featureId, resourceId, pct) => {
    const { pulseId, features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!pulseId || !feature) return;
    const patch: Partial<Feature> = { alloc: { ...(feature.alloc || {}), [resourceId]: pct } };
    await updateFeature(pulseId, featureId, patch);
    recordSingle("Change allocation", pulseId, patchOp("feature", featureId, asDoc(feature), patch));
  },

  addSubtask: async (featureId) => {
    const { pulseId, features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!pulseId || !feature) throw new Error("feature not found");
    const id = `st-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const subtask: Subtask = { id, title: "New subtask", status: "planned", resources: [] };
    const patch: Partial<Feature> = { collapsed: false, children: [...(feature.children || []), subtask] };
    await updateFeature(pulseId, featureId, patch);
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
    await updateFeature(pulseId, featureId, featurePatch);
    recordSingle("Edit subtask", pulseId, patchOp("feature", featureId, asDoc(feature), featurePatch));
  },

  removeSubtask: async (featureId, subtaskId) => {
    const { pulseId, features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!pulseId || !feature) return;
    const patch: Partial<Feature> = { children: (feature.children || []).filter((c) => c.id !== subtaskId) };
    await updateFeature(pulseId, featureId, patch);
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
    await updateFeature(pulseId, featureId, patch);
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
    const attachment: Attachment = {
      id: `at-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      title: (title || raw).trim().slice(0, 120),
      url: finalUrl,
      isData,
    };
    const patch: Partial<Feature> = { attachments: [...(feature.attachments || []), attachment] };
    await updateFeature(pulseId, featureId, patch);
    recordSingle("Add attachment", pulseId, patchOp("feature", featureId, asDoc(feature), patch));
  },

  removeAttachment: async (featureId, attachmentId) => {
    const { pulseId, features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!pulseId || !feature) return;
    const patch: Partial<Feature> = { attachments: (feature.attachments || []).filter((a) => a.id !== attachmentId) };
    await updateFeature(pulseId, featureId, patch);
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

export const graphConfigOf = (pulse: Pulse | null) => pulse?.graphConfig ?? DEFAULT_GRAPH_CONFIG;
