# Resource Master — one roster, many Pulses

Status: **Design agreed — RM1–RM11 decided; RM12–RM14 open (quota shape, the
server-side resource gate, request-access). Nothing built.** ·
Owner: product + eng ·
Related: `Permissions-Spec.md` (the capability model teams must NOT duplicate),
`Costs-Spec.md` §8.3 (rates, the one genuinely sensitive collection),
`Plans-Spec.md` (PL6 — the Workspace *is* the billing org; `maxResourcesPerPulse`),
`Collaboration-Spec.md` (Pulse membership), `Server-Functions-Spec.md` (SF1's
resource fan-out, the precedent for propagation)

## 0. What this is

Today a resource exists only inside one Pulse
(`pulses/{pulseId}/resources/{rid}`). The same person is retyped in every Pulse
they work on, their name drifts between them, and there is no way to ask "what is
Ana working on across everything".

This adds a **workspace-level roster** — masters — that Pulses draw from, plus
**teams** for grouping and sharing.

**What it is not:** a change to how a Pulse is read or rendered. That is the
central constraint, not a nice-to-have — see §2.

## 1. Where things live

```
workspaces/{wsId}/
  resources/{rid}          the master record          (workspace members read)
    usage/{pulseId}        server-maintained index    (workspace members read)
  resourceRates/{rid}      master hourly rate         (workspace OWNERS only)
  teams/{teamId}           grouping + sharing         (see §4)

pulses/{pulseId}/
  resources/{rid}          the Pulse's own copy       (pulse members read)  ← unchanged
  rates/{resourceId}       the Pulse's own rate       (canViewPeopleCost)   ← unchanged
```

The two `pulses/` collections are listed because **they do not change**. Every
rule that governs reading a Pulse stays exactly as it is.

## 2. A Pulse gets a copy, not a reference (RM1)

The decision that constrains everything else, and the permission model makes it
for us.

`firestore.rules:273` reads `allow read: if isPulseMember(pulseId)`. Pulse access
comes from `pulseMembers` and **nothing else** — workspace membership is required
only to *create* a Pulse (`firestore.rules:286`). So an invited collaborator is
routinely a Pulse member who is not a workspace member, and today they can still
see the Pulse's resources because those live inside the Pulse.

If a Pulse held only a pointer into `workspaces/{wsId}/resources/{rid}`, then
rendering it would require that collaborator to read a workspace collection
guarded by `allow read: if isWorkspaceMember(workspaceId)`
(`firestore.rules:224`). Two outcomes, both bad: it breaks for them, or you widen
that rule and hand anyone invited to a single Pulse the org's **entire roster** —
names, types, and eventually rates.

So: **copying is not a compromise, it is the only shape that leaves the
authorization boundary alone.** The `masterId` on the copy is provenance — it
enables §6 and §3 — never indirection at read time.

```
pulses/{pulseId}/resources/{rid}
  … existing fields (name, initials, type, capacity, linkedUid) …
  masterId?: string      // the workspace resource this was copied from
  inherited?: string[]   // fields still tracking the master (see §3)
```

## 3. Propagation has three classes, not two (RM2)

Rename a person at master level and twelve Pulses hold a stale name. But blindly
syncing everything destroys deliberate local edits, and the user cannot tell why
their number keeps reverting. So each field belongs to exactly one class:

| Class | Fields | Behaviour |
| --- | --- | --- |
| **Always** | name, initials, type, avatar, `linkedUid` | Identity. A person's name is not a per-project fact. Overwritten on master change. |
| **Never** | capacity, allocations | Per-Pulse *by nature* — someone is 100% here and 30% there. The master's value is a default used at copy time only. |
| **Unless overridden** | hourly rate | Tracks the master until someone sets it in this Pulse, then never again. See §7. |

The third class needs the `inherited` marker on the copy. Without it there is no
way to distinguish "this equals the master because it was copied" from "someone
typed this exact value here on purpose".

**Detach** is the escape hatch: clearing `masterId` makes a copy purely local and
stops all propagation, permanently.

Propagation is a **server fan-out**, following SF1's existing resource fan-out
(`functions/src/denorm.ts`) rather than inventing a mechanism. Bounded by the
number of Pulses holding the resource, which the §6 index already knows.

## 4. Teams: grouping is easy, sharing is where scope explodes (RM3, RM4)

A team is a document (`workspaces/{wsId}/teams/{teamId}`); membership is a
`teamIds: string[]` on the master resource. Many-to-many falls out of that, team
counts are small, and `array-contains` answers "who is in this team" without a
join collection.

**Sharing is deliberately NOT the Pulse model.** Pulse has roles plus a
materialized capability bundle (`Permissions-Spec.md` §4.1). Reproducing that
here would give the product a **third** authorization system, after workspace
seats and Pulse roles, and every future feature would then have to ask which of
the three governs it.

Two levels, and they mean one narrow thing:

- **use** — see the team, and copy its resources into a Pulse
- **manage** — edit the team's membership and its resources

**Same workspace only**, and the copy target must be a Pulse *in that same
workspace*. The Workspace is the billing org (PL6), so cross-workspace sharing
crosses a billing boundary and immediately raises "whose seat does this consume",
which has no cheap answer. It also bounds §6's disclosure neatly: a usage index
can only ever name Pulses inside the org that already owns the roster.

## 5. Linking is identity; membership is access (RM5)

A master resource may carry `linkedUid`. Copying it down to the Pulse copy is
correct and changes nothing about access: **being linked to a resource on a Pulse
grants no access to that Pulse.** Access is `pulseMembers`, full stop.

This is already true by construction today — `linkedUid` is a field, not a grant
— and it stays true. If the linked person is not a member, they simply do not see
the Pulse.

One wrinkle to know before someone "fixes" it: SF1 maintains `assignedUids` on
features for My-Beat read scoping. A resource linked to a non-member contributes
a uid there that never matches any reader. Harmless, and correct.

## 6. "Where is this person?" (RM6, RM7)

A collection-group query over `pulses/*/resources` is the obvious implementation
and the wrong one — scoping that in rules is hard to get right and easy to get
subtly wrong.

Instead: a **server-maintained usage index**,
`workspaces/{wsId}/resources/{rid}/usage/{pulseId}`, written by a trigger when a
Pulse resource carrying a `masterId` is created or deleted. Server-owned, so the
rule is simply "workspace members may read" — the same shape as SF11's counters.
Each entry stores the Pulse id and a **denormalized Pulse name**.

**The viewer may not have access to every Pulse in that list**, and the answer is
decided: show the **title and a count** anyway, for Pulses in the same workspace.

That is a real disclosure, recorded as such: any workspace member learns the
names of Pulses they cannot open, and who is staffed on them. It is accepted
because the roster and the Pulses belong to the same organisation, and because
the intended follow-up — the linked user asking for access (RM14) — needs a name
to request against. The denormalized name must be refreshed on rename, or the
view goes quietly stale.

**Assignment counts are computed on demand, not maintained.** "Does Ana have
tasks in this Pulse" changes on every task edit; maintaining it by trigger is a
write per edit and makes the resource document a contention point — the same
trade rejected for `lastActivityAt` in `MCP-Spec.md` MC28. Compute it when the
resource detail is opened, for the Pulses the viewer can actually read.

## 7. Rates belong to the person, and still have to be copied (RM8, RM9)

An hourly rate is a property of a human being, not of a project, so the master
holds it. But it cannot be *read* from the master at Pulse render time, for a
reason specific to this codebase:

`pulses/{pulseId}/rates/{resourceId}` is gated by
`isPulseMember(pulseId) && canViewPeopleCost(pulseId)` — a **Pulse-level**
capability. A Pulse admin who is not a workspace member can read rates in their
Pulse today and must continue to. Master rates live at
`workspaces/{wsId}/resourceRates/{rid}`, readable by workspace **owners** only
(`WorkspaceRole` is `owner | member`, `src/types/index.ts:76`).

So the rate is copied down like everything else, into the existing per-Pulse
rates collection, marked `inherited`. Master changes refresh only the copies
still marked inherited; the moment someone sets a rate in a Pulse, that Pulse
stops tracking. Cost reporting keeps working unchanged for everyone who can do it
today, including non-workspace members.

Keeping master rates in a **separate collection** from the master resource
mirrors Costs-Spec §8.3's reason: the resource document must stay
workspace-member-readable, and Firestore security is per document.

## 8. Quotas — and a gap this will expose (RM10)

`maxResourcesPerPulse` is 20 / 40 / unlimited by tier
(`src/domain/entitlements.ts:16`). **It is enforced only in the client. There is
no rule.** Nothing in `firestore.rules` counts resources in a Pulse.

That is survivable while resources are typed in one at a time. A "copy this team
into my Pulse" button makes exceeding it a single click, which turns a soft
client gate into an obvious hole. Fixing it needs a server-owned counter, the SF11
`pulseCount` pattern applied to `pulses/{id}.resourceCount` — and per this
project's own deploy note, **the counter must ship before the rule that reads
it**, or the gate is inert.

Whether the *master* roster has its own cap is open (RM12).

## 9. Surface area

A new dashboard section is not just a route:

- **Mobile** — a new surface, or an explicit decision that masters are desktop-only.
- **i18n** — six locales, from the first string.
- **Help** — a permission-granting, sharing-capable feature with no explanation is
  one nobody trusts.

## 10. Phasing

Each phase is shippable and leaves the product coherent.

1. **Masters + copy into a Pulse.** `masterId` and the `inherited` marker written
   from the very first copy, even though nothing propagates yet — retrofitting
   provenance onto existing copies means guessing.
2. **Usage index + "where used"**, with the RM7 disclosure implemented as decided.
3. **Teams**, grouping only.
4. **Team sharing**, two levels, same workspace.
5. **Propagation** switched on, per RM2's classes.
6. **Master rates** — last, because it is the one that touches money, and because
   `resourceCount` (RM10) should exist before bulk copying does.

---

## Decisions

1. **RM1 — A Pulse holds a copy carrying `masterId`, not a reference → DECIDED.**
   Pulse access is `isPulseMember` alone (`firestore.rules:273`), independent of
   workspace membership, so an invited collaborator is routinely not a workspace
   member. A reference model would require them to read
   `workspaces/{wsId}/resources`, guarded by `isWorkspaceMember`
   (`firestore.rules:224`) — which either breaks for them or, if widened, exposes
   the org's entire roster to anyone invited to one Pulse. *Rejected: (c) assign
   the master to the Pulse* — that is the reference model, and it fails on the
   above. *Rejected: (a) copy with no link* — cheap and sync-free, but it makes
   the master a clipboard: RM6 becomes impossible and names drift permanently.
   The copy is what the Pulse renders from; the pointer is provenance only, never
   dereferenced at read time.
2. **RM2 — Propagation is per-field, in three classes → DECIDED.** *Always*
   (identity: name, initials, type, avatar, `linkedUid`); *never* (capacity and
   allocations, which are per-Pulse by nature); *unless overridden* (rate, §7).
   *Rejected: propagate everything* — it stomps deliberate local edits with no
   way for the user to see why a value reverted. *Rejected: propagate nothing* —
   then a rename never reaches the Pulses, which is most of the point. The
   `inherited` marker exists because otherwise "equals the master because it was
   copied" and "typed here on purpose" are indistinguishable. Detaching (clearing
   `masterId`) stops propagation permanently.
3. **RM3 — Masters are workspace-scoped, and a copy target must be a Pulse in the
   same workspace → DECIDED.** The Workspace is the billing org (PL6), so this
   keeps the roster inside one billing and permission boundary, and bounds RM7's
   disclosure to Pulses the org already owns. *Rejected: cross-workspace copying*
   — it crosses a billing boundary and raises "whose seat does this consume",
   which has no cheap answer.
4. **RM4 — Teams are documents; membership is `teamIds[]` on the resource →
   DECIDED.** Many-to-many falls out, `array-contains` answers the queries, team
   counts are small. *Rejected: a join collection* — more documents and more
   rules for no capability gained at this scale.
5. **RM5 — Team sharing is two levels (`use`, `manage`), same workspace only →
   DECIDED.** *Rejected: mirroring the Pulse role/caps model* — it would make team
   sharing the product's **third** authorization system after workspace seats and
   Pulse roles, and every later feature would have to ask which one governs it.
   The actual requirement is narrow: let someone build Pulses using my team.
6. **RM6 — Linking is identity; it grants no Pulse access → DECIDED (product).**
   `linkedUid` copied from master changes nothing about visibility; access remains
   `pulseMembers`. Already true by construction. Note for future readers: SF1's
   `assignedUids` will contain uids of non-members, which is harmless and correct.
7. **RM7 — "Where used" shows the Pulse title and a count even for Pulses the
   viewer cannot open → DECIDED (product).** Served from a server-maintained
   `usage/{pulseId}` index rather than a collection-group query, which is hard to
   scope safely in rules. **The disclosure is deliberate and worth restating:** any
   workspace member learns the names of Pulses they cannot open, and who is
   staffed on them. Accepted because roster and Pulses belong to the same
   organisation, and because RM14's request-access flow needs a name to request
   against. Consequence: the denormalized Pulse name must be refreshed on rename
   or the view goes quietly stale. *Rejected: hiding inaccessible Pulses entirely*
   — safer, but it makes RM6's "where is this person" answer silently incomplete,
   which is worse than a disclosure the org already tolerates internally.
8. **RM8 — Per-resource assignment counts are computed on demand → DECIDED.**
   Maintaining them by trigger is a write per task edit and makes the resource
   document a contention point — the same trade rejected in `MCP-Spec.md` MC28 for
   `lastActivityAt`, for the same reasons. Computed when the detail view opens,
   only for Pulses the viewer can read.
9. **RM9 — Rates belong to the person, and are copied down marked `inherited` →
   DECIDED (product + eng).** The master holds the rate because a rate is a
   property of a human, not a project. It is nonetheless copied into
   `pulses/{id}/rates/{resourceId}` rather than read live, because that collection
   is gated by `canViewPeopleCost(pulseId)` — a **Pulse** capability — and a Pulse
   admin who is not a workspace member can read rates today and must continue to.
   Master rates live in their own collection
   (`workspaces/{wsId}/resourceRates/{rid}`, workspace owners only), separate from
   the master resource for exactly Costs-Spec §8.3's reason: the resource document
   must stay workspace-member-readable and Firestore security is per document.
   *Rejected: resolving the rate server-side per request* — heavier, and it makes
   every cost view depend on a function being up.
10. **RM10 — Bulk copy requires a server-side resource counter first → DECIDED.**
    `maxResourcesPerPulse` (`src/domain/entitlements.ts:16`) is enforced **only in
    the client**; no rule counts resources. One-at-a-time entry made that
    survivable, a "copy this team in" button does not. Needs `pulses/{id}.resourceCount`
    on the SF11 `pulseCount` pattern — and the counter must ship **before** the
    rule that reads it, or the gate is inert (`CLAUDE.md`, deploy order).
11. **RM11 — Phase in the order of §10 → DECIDED.** Provenance fields
    (`masterId`, `inherited`) are written from the first copy even though nothing
    propagates until phase 5, because retrofitting provenance onto copies that
    already exist means guessing which of them came from where.

## Open

12. **RM12 — Does the master roster have its own quota?** Per-Pulse caps still
    apply on copy, so the exposure is storage rather than entitlement.
    *Recommend: no master cap initially*, and revisit if a workspace ever holds an
    unreasonable roster. Tiers differ only by quantity (`Plans-Spec.md` §3), so if
    a cap is added it must be a quantity, not a feature gate.
13. **RM13 — Does deleting a master delete the copies?** Almost certainly not —
    a Pulse's plan should not lose its people because someone tidied the roster.
    *Recommend: deleting a master detaches every copy* (clears `masterId`), leaving
    each Pulse intact and self-sufficient. Needs deciding before phase 1, because
    it determines whether `masterId` can ever dangle.
14. **RM14 — Request access.** A linked user who can see they are staffed on a
    Pulse they cannot open should be able to ask. Out of scope for phase 1;
    listed because RM7's disclosure was accepted partly on the strength of it, and
    a decision that leans on a future feature should say so.
