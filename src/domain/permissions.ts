// Granular permissions — the capability model (Permissions-Spec.md §3).
//
// Each role maps to a `Capabilities` bundle. A member's effective caps are their
// explicit `caps` if present, else the preset for their (canonicalized) role —
// the backward-compatible fallback for legacy docs. Firestore rules mirror this
// table once enforcement ships; for now it drives the client (labels, badges,
// canEdit) with behaviour identical to today's owner/editor/viewer.

import type { Capabilities, PulseMember, PulseRole } from "@/types";

/** Roles that carry a fixed preset (everything except the legacy alias). */
type PresetRole = Exclude<PulseRole, "viewer">;

/** Legacy "viewer" reads as "fullViewer". */
export function canonicalRole(role: PulseRole): PresetRole {
  return role === "viewer" ? "fullViewer" : role;
}

export const PRESET_CAPS: Record<PresetRole, Capabilities> = {
  owner: { readScope: "all", editScope: "all", editEpics: true, editResources: true, editConfig: true, comment: true, invite: true, manageMembers: true, deletePulse: true, viewPeopleCost: true },
  editor: { readScope: "all", editScope: "all", editEpics: true, editResources: true, editConfig: true, comment: true, invite: true, manageMembers: false, deletePulse: false, viewPeopleCost: false },
  fullViewer: { readScope: "all", editScope: "none", editEpics: false, editResources: false, editConfig: false, comment: true, invite: false, manageMembers: false, deletePulse: false, viewPeopleCost: false },
  myBeatViewer: { readScope: "beat", editScope: "none", editEpics: false, editResources: false, editConfig: false, comment: true, invite: false, manageMembers: false, deletePulse: false, viewPeopleCost: false },
  taskLead: { readScope: "all", editScope: "lead", editEpics: false, editResources: false, editConfig: false, comment: true, invite: false, manageMembers: false, deletePulse: false, viewPeopleCost: false },
  // `custom` requires explicit `caps`; this is only the safety fallback.
  custom: { readScope: "all", editScope: "none", editEpics: false, editResources: false, editConfig: false, comment: true, invite: false, manageMembers: false, deletePulse: false, viewPeopleCost: false },
};

/** May this member see and set hourly rates, and the labour costs derived from
 * them? Owner-only by preset (Costs-Spec §8.7 / CO15). Absent on a legacy `caps`
 * bundle reads as false — pay data fails closed. */
export function canViewPeopleCost(member: Pick<PulseMember, "role" | "caps">): boolean {
  return capsOf(member).viewPeopleCost === true;
}

/** The capability bundle a role preset carries — materialized onto the member doc. */
export function capsForRole(role: PulseRole): Capabilities {
  return PRESET_CAPS[canonicalRole(role)];
}

/** A member's effective capabilities: explicit `caps`, else the role preset. */
export function capsOf(member: Pick<PulseMember, "role" | "caps">): Capabilities {
  return member.caps ?? capsForRole(member.role);
}

export function canEditAnything(caps: Capabilities): boolean {
  return caps.editScope !== "none";
}

export interface RoleMeta {
  label: string;
  hint: string;
  badgeBg: string;
  badgeFg: string;
}

export const ROLE_META: Record<PresetRole, RoleMeta> = {
  owner: { label: "Owner", hint: "Full control — manage members & delete", badgeBg: "#FEF0E7", badgeFg: "#C2410C" },
  editor: { label: "Editor", hint: "Edits everything", badgeBg: "#EAF1FB", badgeFg: "#1D4ED8" },
  fullViewer: { label: "Full Viewer", hint: "Reads & comments on the whole Pulse", badgeBg: "#F1F5F9", badgeFg: "#475569" },
  myBeatViewer: { label: "My-Beat Viewer", hint: "Sees only tasks their linked resource is on", badgeBg: "#E7F6F1", badgeFg: "#0F766E" },
  taskLead: { label: "Task Lead", hint: "Edits only the tasks they lead; reads the rest", badgeBg: "#F1ECFE", badgeFg: "#7C3AED" },
  custom: { label: "Custom", hint: "Custom capabilities", badgeBg: "#F1F5F9", badgeFg: "#64748B" },
};

export function roleMeta(role: PulseRole): RoleMeta {
  return ROLE_META[canonicalRole(role)];
}

/**
 * Roles the assign-role / invite pickers offer. `taskLead` and `myBeatViewer`
 * are enforced in firestore.rules (Permissions-Spec §4.3–4.4). Both scoped roles
 * need the member linked to a resource. The stored value for read-only stays the
 * legacy `"viewer"` (rules-compatible) but is labelled "Full Viewer".
 */
export const ASSIGNABLE_ROLES: { value: PulseRole; label: string; hint: string }[] = [
  { value: "editor", label: "Editor", hint: "Edits everything" },
  { value: "taskLead", label: "Task Lead", hint: "Edits only tasks they lead; needs a linked resource" },
  { value: "myBeatViewer", label: "My-Beat Viewer", hint: "Sees only tasks their linked resource is on" },
  { value: "viewer", label: "Full Viewer", hint: "Reads & comments" },
];
