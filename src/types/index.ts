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
  /** User-managed, ordered Kanban statuses. Unset/empty = the built-in four
   * (DEFAULT_STATUSES). "done" is a reserved terminal status: always present,
   * can't be removed or reordered out of last position, and moving a task into
   * it stamps the finished date and locks it. */
  statuses?: StatusDef[];
  /** Active copy-link invite (owner/editor generated). Null/absent = none. */
  invite?: InviteLink | null;
}

/** One Kanban/status column. `id` is what Feature.status / Subtask.status
 * reference; `color` drives the badge/column tint (bg/text derived). */
export interface StatusDef {
  id: string;
  label: string;
  color: string;
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
  /** Present when the member joined via a copy-link; the security rule checks
   * it matches the Pulse's active invite token. */
  joinToken?: string;
}

/** A comment, at pulses/{id}/comments/{cid}. `targetId` is the task it's on, or
 * null for a Pulse-level comment; `parentId` is set on a reply. */
export interface Comment {
  id: string;
  targetId: string | null;
  parentId: string | null;
  authorUid: string;
  authorEmail: string;
  text: string;
  createdAt: number;
  editedAt?: number;
}

/** An in-Pulse notification for a member, at pulses/{id}/notifications/{nid}. */
export interface Notification {
  id: string;
  targetUid: string;
  actorUid: string;
  actorEmail: string;
  type: "comment";
  featureId: string;
  featureTitle: string;
  text: string; // short snippet
  createdAt: number;
  read?: boolean;
}

/** Live presence heartbeat — one per viewer, at pulses/{id}/presence/{uid}. */
export interface PresenceEntry {
  uid: string;
  email: string;
  lastSeen: number; // ms epoch; stale entries are filtered client-side
}

/** A shareable "copy-link" invite living on the Pulse doc. The token is the
 * unguessable capability; the role is what a joiner is granted. Null/absent =
 * no active link. */
export interface InviteLink {
  token: string;
  role: PulseRole;
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
  archived?: boolean; // per-user: hides the Pulse into the dashboard's Archived section
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

// A status id. The built-in ids are "planned" | "in-progress" | "blocked" |
// "done"; Pulses may define additional custom ids (see Pulse.statuses). "done"
// is always reserved/terminal. Kept as a plain string so custom statuses work.
export type FeatureStatus = string;

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
  notes?: string; // rich-text (HTML) detail annotation
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
  finishedAt?: string | null; // YYYY-MM-DD; auto-set when marked done, cleared when reopened, editable
  notes?: string; // rich-text (HTML) detail annotation
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
