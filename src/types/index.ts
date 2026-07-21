// Core data model — spec §3 (Core entities) + §8 (Accounts, multi-tenancy &
// sharing). Firestore layout is documented in /firestore.rules.

export type Timestamp = number; // Date.now() / Firestore serverTimestamp() millis

// ---------------------------------------------------------------------------
// Accounts, workspaces, Pulses, membership & invites (spec §8)
// ---------------------------------------------------------------------------

export interface UserDoc {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  personalWorkspaceId: string;
  createdAt: Timestamp;
}

export interface Workspace {
  id: string;
  name: string;
  isPersonal: boolean;
  ownerId: string;
  createdAt: Timestamp;
}

export type WorkspaceRole = "owner" | "member";

export interface WorkspaceMember {
  uid: string;
  role: WorkspaceRole;
  joinedAt: Timestamp;
}

export interface Pulse {
  id: string;
  workspaceId: string;
  name: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  graphConfig: GraphConfig;
  /** User-managed category list for Resources (spec §3's "user-manageable
   * list, addable/renameable/deletable"). Starts empty for a new Pulse —
   * the prototype's Nubceo-flavored starter list isn't shipped as a
   * default (spec §9/§11: no domain-specific sample data in the real app). */
  resourceTypes: string[];
}

/** Graph Effort scale (spec §4) — user-adjustable per Pulse. */
export interface GraphConfig {
  stepPx: number; // px per height step, default 16
  workPerStep: number; // work units per step, default 1
}

export const DEFAULT_GRAPH_CONFIG: GraphConfig = { stepPx: 16, workPerStep: 1 };

/** owner: full control incl. delete Pulse, manage members.
 *  editor: can edit everything §3–§6 covers.
 *  viewer: read-only. */
export type PulseRole = "owner" | "editor" | "viewer";

export interface PulseMember {
  uid: string;
  email: string;
  role: PulseRole;
  joinedAt: Timestamp;
}

/**
 * Pending invite. Document ID is the invited email, lowercased and sanitized
 * (see `inviteDocId` in services/firestore/invites.ts) rather than an
 * auto-id — security rules can only `get()` a document by a known path, not
 * run a query, so the invite a signing-in user should resolve against must
 * be addressable directly from their own auth token email.
 */
export interface Invite {
  email: string;
  role: PulseRole;
  invitedBy: string;
  createdAt: Timestamp;
  /** If set, accepting this invite links the new member to this existing
   * freeform Resource row instead of creating a fresh one. */
  linkResourceId?: string;
}

/**
 * users/{uid}/myPulses/{pulseId} — denormalized "every Pulse I can access"
 * index the dashboard reads directly, instead of a collectionGroup query
 * (see firestore.rules for why). Pure convenience cache: real access to a
 * Pulse's data is always independently re-checked against its pulseMembers
 * doc, so a stale/corrupt entry here can only break the owning user's own
 * dashboard card, never grant anyone unauthorized access.
 */
export interface MyPulseIndexEntry {
  pulseId: string;
  name: string;
  workspaceId: string;
  role: PulseRole;
  joinedAt: Timestamp;
}

/**
 * inviteIndex/{emailId}/pending/{pulseId} — lets a not-yet-member user
 * discover which Pulses invited them (by email) without already knowing the
 * pulseId, and without a collection-group query (see firestore.rules).
 */
export interface PendingInviteEntry {
  pulseId: string;
  role: PulseRole;
  invitedBy: string;
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Canvas entities (spec §3, §4) — live under pulses/{pulseId}/...
// ---------------------------------------------------------------------------

export type FeatureStatus = "planned" | "in-progress" | "blocked" | "done";

export interface Attachment {
  id: string;
  title: string;
  url: string;
  isData?: boolean;
}

export interface Epic {
  id: string;
  name: string;
  color: string;
  y0: number;
  y1: number;
  // Nullable rather than `| undefined` — Firestore's updateDoc() rejects
  // `undefined` field values, so clearing an override (e.g. after
  // "Compact") writes `null`, not `undefined`.
  manualY0?: number | null;
  manualY1?: number | null;
  manualMinX?: number | null;
  manualMaxX?: number | null;
}

export interface Subtask {
  id: string;
  title: string;
  status: FeatureStatus;
  resources: string[];
  alloc?: Record<string, number>;
  notes?: string; // free-text detail annotation
  finishedAt?: string | null; // YYYY-MM-DD; auto-set when marked done, cleared when reopened, editable
}

export interface Feature {
  id: string;
  title: string;
  x: number; // start day, integer offset from epoch
  y: number; // vertical position (px)
  duration: number; // calendar-day span
  work?: number; // drives box height via the Graph Effort scale
  effort?: number; // legacy alias for `work`, kept for data compat
  status: FeatureStatus;
  resources: string[];
  alloc?: Record<string, number>; // resourceId -> % time (default 100)
  lead?: string | null; // resource id marked as team leader
  epicId?: string | null;
  labelColor?: string | null;
  ai?: boolean; // "AI-assisted estimate" flag
  useWeekends?: boolean;
  estEffort?: number | null; // manual Estimate Effort override; null/unset = tracks Graph Effort
  // Frozen baseline snapshot ("📌 set plan"). Nullable rather than
  // `| undefined` on purpose — Firestore's updateDoc() rejects `undefined`
  // field values, so "clear the plan" writes `null`, not `undefined`.
  plannedX?: number | null;
  plannedDuration?: number | null;
  attachments?: Attachment[];
  children?: Subtask[];
  collapsed?: boolean;
}

/**
 * A team member. Unlike the prototype (where 2-3 letter `id` initials were
 * themselves the primary key), the persisted Resource's canonical `id` is an
 * opaque Firestore doc id — safe under concurrent multi-tenant writes, where
 * two people could otherwise race to create the same initials. `initials` is
 * a separate, still-deduplicated-at-creation-time display field.
 */
export interface Resource {
  id: string;
  initials: string;
  name: string;
  capacity: number; // occupation limit %, default 100
  type: string | null;
  /** Linked to a real Pulse member's uid, if this Resource maps 1:1 to an
   * invited account (spec §8 — "allow both", visually distinguish). */
  linkedUid?: string | null;
}
