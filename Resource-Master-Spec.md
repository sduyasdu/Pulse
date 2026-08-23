# Resource Master — one roster, many Pulses

Status: **Phase 0 BUILT and live (2026-08-22) — the resource counter, its daily
reconcile, and the `maxResourcesPerPulse` rule. Phases 1–6 not started.
RM1–RM11, RM13, RM15–RM21 decided; RM12 and RM14 open, neither blocking.** ·
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
  … existing fields (name, initials, type, capacity) …
  masterId?: string      // the workspace resource this was copied from
                         // — presence alone means "identity tracks the master"
  linkedEmail?: string   // WHO this is meant to be — durable         (see §5)
  linkedUid?: string     // who it resolved to, if they have an account
```

## 3. Every field belongs to exactly one propagation class (RM2)

Rename a person at master level and twelve Pulses hold a stale name. But blindly
syncing everything destroys deliberate local edits, and the user cannot tell why
their number keeps reverting. So each field belongs to exactly one class:

| Class | Fields | Behaviour |
| --- | --- | --- |
| **Always** | name, initials, type, avatar, `linkedEmail` | Identity. A person's name is not a per-project fact. Overwritten on master change. |
| **Derived, never propagated** | `linkedUid` | Resolved locally from `linkedEmail` against *this* Pulse's membership (§5). Copying a master's uid down would assert a Pulse membership that may not exist. |
| **Never** | capacity, allocations | Per-Pulse *by nature* — someone is 100% here and 30% there. The master's value is a default used at copy time only. |
| **Unless overridden** | hourly rate | Tracks the master until someone sets it in this Pulse, then never again. See §7. |

**Unless-overridden** needs an `inherited` marker. Without it there is no way to
distinguish "this equals the master because it was copied" from "someone typed
this exact value here on purpose".

**That marker lives on the rate document, not on the resource** — rate is the only
field in that class, and rates are a separate collection (§7). The resource
itself needs no marker: `masterId` being present *is* the statement that identity
tracks the master, capacity never tracks it, and detaching clears the one field.
An earlier draft of this section put an `inherited` array on the resource; it
would have marked nothing.

**Derived** is not a weaker form of propagation — it is the absence of it.
`linkedUid` is computed locally against *this* Pulse's membership, and pushing a
master's uid down would assert a Pulse membership that may not exist (§5).

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

## 5. Linking: email is the intent, uid is the resolution (RM5, RM16–RM18)

**A resource is linked to an *email*.** The uid is not the link — it is what the
email resolved to once that person turned out to have an account with access.
Two fields, and keeping them separate is what makes the rest of this section
short.

This mirrors how the product already identifies people who have not arrived yet:
invites are keyed by email (`pulses/{id}/invites/{emailKey}`), and `emailKey()`
— trim and lowercase — is already the canonical form compared against
`request.auth.token.email.lower()` in the rules. **Reuse it.** `Ana@x.com` and
`ana@x.com` are one person or the whole model leaks duplicates.

### 5.1 At master level

A master resource carries `linkedEmail`. If that email already belongs to a
workspace member, `linkedUid` resolves immediately; otherwise it stays empty and
the roster entry is still perfectly usable — which is the point, because a
roster exists before its people have logged in.

### 5.2 At Pulse level

A Pulse resource carries both fields too, **stored, not read from the master** —
`RM1` requires the copy to be self-sufficient because a non-workspace member
cannot read master documents.

Two ways one gets there, with different constraints, and the difference is
deliberate (RM18):

- **Copied from a master.** Brings the master's `linkedEmail`, which may name
  someone who is not a collaborator on this Pulse. `linkedUid` is left unresolved
  until they are. **That address is visible to every member of this Pulse**,
  including external collaborators — a deliberate disclosure, decided in RM19.
- **Linked by hand in the Team tab.** Unchanged from today: the dropdown offers
  **only current collaborators** (`TeamTab.tsx:215`), so a hand-made link always
  resolves at once.

While `masterId` is set, `linkedEmail` is **locked locally** — the master owns
who this is. A Pulse that genuinely needs to disagree detaches (`RM13`), which is
the escape hatch that already exists.

### 5.3 Resolution happens on arrival, in two places (RM16)

Nothing polls. Two triggers, each a bounded query on an email that just became
usable:

| Event | Effect |
| --- | --- |
| Someone joins the **workspace** | Resolve `linkedUid` on master resources whose `linkedEmail` matches |
| Someone joins a **Pulse** | Resolve `linkedUid` on that Pulse's resources whose `linkedEmail` matches |

The second is what closes the loop for a master copied in ahead of its person:
the resource sits with an email and no uid until they accept the invitation, and
then it simply works — nobody has to remember to go back and link it.

**`WorkspaceMember` has no email field today** (`{uid, role, joinedAt}`), unlike
`PulseMember`. Give it one, denormalised on join, so the first trigger is a
single query rather than a member-doc read followed by a `users/{uid}` lookup.

### 5.4 Removal clears the resolution, not the intent (RM17)

Today SF7 (`functions/src/cascade.ts:65`) sets `linkedUid: null` when a member is
removed from a Pulse. That stays — but it now clears **only the uid**. The email
survives, so if that person is invited back, §5.3 re-resolves them and the link
returns.

That makes "unlink" two distinct operations, and they must not be confused:

- **Removed from the Pulse** → clear `linkedUid`, keep `linkedEmail`. A
  membership change is not a statement about who this resource *is*.
- **The user unlinks deliberately** → clear both. That is a statement.

This is also what dissolves a conflict the earlier draft of this spec had: with a
single `linkedUid`, SF7's clear and master propagation fought each other and a
link would resurrect after being cleared. Splitting intent from resolution makes
the same behaviour correct instead of a bug.

### 5.5 Access is still not implied (RM6)

Unchanged and load-bearing: **being linked grants nothing.** Access is
`pulseMembers`, full stop. A resource linked to someone who is not a member is
inert — they do not see the Pulse, and SF1's `assignedUids` will carry a uid that
matches no reader, which is harmless and correct.

### 5.6 Showing which links are live, and which are waiting (RM20)

Inside a Pulse it must be visible **at a glance** which linked people are actually
collaborators here and which are not — otherwise a roster copied from a master
looks like a fully staffed team when half of it cannot see the Pulse.

**No new field is needed, and none should be added.** The distinction is exactly
the two fields already in §5:

| State | Data | Means |
| --- | --- | --- |
| **Not linked** | no `linkedEmail` | a placeholder — a role, a contractor, a name with no account behind it |
| **Linked, live** | `linkedEmail` + `linkedUid` | a current collaborator on this Pulse |
| **Linked, waiting** | `linkedEmail`, no `linkedUid` | rostered, but **not a collaborator here** — they cannot see this Pulse |

That mapping is exact rather than approximate, and it stays exact on its own:
RM16 sets `linkedUid` when someone joins, RM17 clears it when they are removed.
A stored `isCollaborator` flag would say the same thing while being able to drift
from it, which is the only way this can go wrong.

**Say what is true, not what is guessed.** "Linked, waiting" has two causes that
the Pulse genuinely cannot tell apart: the person has an account but was never
invited here (or was removed), or they have no account at all. Distinguishing
them would mean reading a user document that a Pulse member has no right to read.
So the label is about *this Pulse* — "not a collaborator on this Pulse", true in
both cases and the only part that affects what they can see.

The visible consequence to surface alongside it: a waiting link means **no
My-Beat visibility** and no notifications for that person here, because SF1's
`assignedUids` has no uid to carry.

The natural affordance is to offer the invite from that row — the flow already
exists, the email is already in hand, and the admin looking at the row is usually
the person who can fix it. That is the mirror of RM14, which is the *linked
person* asking to be let in.

The same three states exist at master level against **workspace** membership, and
should read the same way there.

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
rates collection, under the rule that already exists. Cost reporting keeps
working unchanged for everyone who can do it today, including non-workspace
members.

**Why the copy needs a marker.** A stale rate is not cosmetic like a stale name —
it produces wrong money, in cost reports and budgets, so propagation matters more
here than for identity. But a per-Pulse rate is legitimate and common: this
client is billed differently, this engagement was quoted at last year's rate and
must stay frozen, this project carries a negotiated discount. Which leaves two
states that are **identical in the data**:

```
{ hourlyCost: 100 }   ← copied from a master that says 100
{ hourlyCost: 100 }   ← someone typed 100 here on purpose
```

Overwrite both and you silently undo a commercial decision; overwrite neither and
the master is decorative. So:

- **on copy** → the Pulse rate is written `inherited: true`
- **master rate changes** → the fan-out touches only docs still marked inherited
- **someone edits the rate in the Pulse** → `inherited` goes false, permanently
- **"reset to master rate"** → sets it back to true, for the customer who changed
  their mind

This is why rate is a *third* propagation class (§3) rather than being forced
into one of the other two. Name is always-propagate — nobody has a different name
per project. Capacity is never-propagate — a different value per Pulse is the
normal case. Rate is genuinely in between: usually the same everywhere, so
propagation is valuable; sometimes deliberately different, so overwriting is
destructive.

Keeping master rates in a **separate collection** from the master resource
mirrors Costs-Spec §8.3's reason: the resource document must stay
workspace-member-readable, and Firestore security is per document.

## 8. Enforcing `maxResourcesPerPulse` on the server (RM10, RM15)

`maxResourcesPerPulse` is 20 / 40 / unlimited by tier
(`src/domain/entitlements.ts:16`). **It is enforced only in the client. There is
no rule** — nothing in `firestore.rules` counts resources in a Pulse, so today
the cap is a suggestion that any direct write ignores.

That was survivable while resources were typed in one at a time. "Copy this team
into my Pulse" makes exceeding it a single click, so this has to be closed before
phase 1 ships, not after.

Note it is already reachable without masters: `duplicatePulse` in *full* mode
(`src/services/firestore/pulses.ts`) copies every resource from the source, so
duplicating a 40-resource Pulse into a Starter workspace already creates 40.
Closing this fixes that too.

### 8.1 The counter

Follow SF11 exactly (`functions/src/counters.ts`) rather than inventing a second
pattern:

- **`pulses/{pulseId}.resourceCount`**, written by a new trigger pair on
  `pulses/{pulseId}/resources/{rid}` create and delete.
- **Recount with `count()`, never `FieldValue.increment`.** Firestore delivers
  triggers at-least-once, so an incremented counter drifts upward on redelivery
  and never repairs itself. A recount is idempotent and self-healing: whatever
  the stored number was, the next create or delete corrects it.
- **Server-owned.** `firestore.rules:40` lists `SERVER_COUNTERS()` for the
  workspace document; the Pulse update rule needs the same treatment for
  `resourceCount`. A client that can set its own counter can set it to zero, and
  the gate becomes decoration.

### 8.2 The rule

Mirror `maxPulsesFor` / `withinPulseQuota` (`firestore.rules:60`, `:73`), with
`-1` for unlimited as those already do:

```
function maxResourcesFor(orgId) {
  let tier = planTierOf(orgId);
  return tier == 'business' ? -1 : (tier == 'pro' ? 40 : 20);
}
```

Two things to watch, both cheap to check and expensive to discover late:

- **The `get()` budget.** The resource-create rule already calls
  `canWriteContent(pulseId)`, which reads documents. Adding a quota check means
  reading the Pulse doc for its `workspaceId` and then `planTierOf(orgId)`, which
  itself does an `exists()` plus up to two `get()`s on `billing/{orgId}`. Rules
  cap document accesses per request. **Measure it in
  `rules/security.test.ts` before assuming it fits.** If it does not, the fallback
  is to denormalize the *limit* (`pulses/{id}.maxResources`) alongside the count,
  reducing the rule to one read — at the cost of refreshing it whenever the plan
  changes.
- **Absent means zero**, exactly as `pulseCount` does (`firestore.rules:67`). A
  Pulse that predates the counter reads as 0 and gets a free pass until its first
  create or delete triggers a recount. **Backfill it.** SF11's own `pulseCount`
  backfill was specified and never run; repeating that here means every existing
  Pulse silently carries no cap until someone touches it.

### 8.3 The rule alone cannot stop the burst

This is the part that matters, and it is why the counter is necessary but not
sufficient.

The counter is written **asynchronously by a trigger**. SF11 accepts the
consequence explicitly — "a rapid burst of creates can transiently allow one past
the cap before the counter catches up" — because for Pulse creation a burst is an
edge case.

For "copy this team in", **the burst is the normal path.** A parallel write of
twenty resources has every one of them evaluated against the same stale count, so
every one passes. The rule would stop the *twenty-first* copy operation and none
of the twenty writes inside it.

So bulk copy cannot be a client loop under a rule. It has to be a **callable**
that reads the current count, checks the tier and writes with the Admin SDK — the
one place where the check and the writes are ordered. Ad-hoc single adds stay
client-side under the rule, where a burst is genuinely an edge case and eventual
convergence is the right trade.

### 8.4 Deploy order

The counter ships **before** the rule that reads it. A gate reading a field
nothing writes yet is inert, and looks deployed (`CLAUDE.md`, "the order follows
the data dependency"). Concretely: trigger → backfill → rule → the copy UI.

Whether the *master* roster has its own cap is open (RM12).

## 9. Surface area

A new dashboard section is not just a route:

- **Mobile** — a new surface, or an explicit decision that masters are desktop-only.
- **i18n** — six locales, from the first string.
- **Help** — a permission-granting, sharing-capable feature with no explanation is
  one nobody trusts.

## 10. MCP surface (RM21)

The roster is the first thing in Pulse that answers a question **across** Pulses,
which is exactly the shape an assistant is good at. Three tools, and they inherit
their permissions rather than declaring any.

| Tool | Returns | Phase |
| --- | --- | --- |
| `search_roster` | the workspace's people: name, type, teams, link state (§5.6), master rate where the caller may see it | 1 |
| `get_resource_usage` | which Pulses one person is on, and whether they have assignments there (RM7, RM8) | 2 |
| `list_teams` | teams in the workspace with their sizes | 3 |

**`search_roster` is deliberately not `search_resources`.** The existing tool
answers "who is on *this Pulse*" and takes a `pulseId`; this one answers "who
does this organisation have". Two tools whose descriptions do not separate
cleanly is how an assistant picks the wrong one, so the names and descriptions
have to make the scope obvious — `search_resources` stays Pulse-scoped and
unchanged.

**Permissions come for free, and that is the point.** The MCP service reads as
the customer through the Firestore REST API (`MCP-Spec.md` §1), so a caller who
is not a workspace member gets a 403 on the roster, which `listAsUser` turns into
an empty result. No new check, no second copy of the rule. The same applies to
master rates: they live in their own workspace-owner-only collection (§7), so a
caller who cannot read them simply gets none — and the result carries the same
"empty may mean no access" note `get_costs` and `search_resources` already use,
because an absent rate must not read as a free person.

**`get_resource_usage` surfaces RM19's and RM7's disclosure through a new
channel.** It will name Pulses the caller cannot open. That is the same decision
already taken for the UI, but an assistant *saying* it out loud is more startling
than seeing it in a list, so the tool description must state plainly that these
are Pulses the user has no access to — the assistant should explain the boundary,
not imply the user can go and look.

**Deliberately not built: cross-Pulse people load.** "Who is over-committed across
everything" is the most valuable question the roster makes askable, and the most
expensive: it means reading features from every Pulse a person appears in, N ×
the per-Pulse cost, against tools already capped at 200 documents (`MC29`'s rate
limits exist for exactly this shape of request). The usage index makes it
*possible* — it says which Pulses to look at — but it should wait for evidence
that people ask for it, and then probably be a purpose-built aggregate rather
than a fan-out of `get_people_load`.

**Copying a resource into a Pulse is a Phase 2 write tool**, not a read. It is a
good first candidate when MCP writes land: bounded, idempotent-ish, and the
callable already has to exist for the UI (RM15).

Adding these is a **tool-surface change**: bump `SERVER_INFO.version`, annotate
each with `title` and the behaviour hints (`MCP-Publishing-Spec.md` MP1), and
expect every connected customer to reconnect before they appear (`MC15`, `MC19`).

## 11. Phasing

Each phase is shippable and leaves the product coherent.

0. **The resource counter, backfill and rule** (§8, RM10) — **DONE 2026-08-22.**
   Shipped in dependency order: the triggers and the daily reconcile first, then
   the rule, because a gate reading a field nothing writes yet is inert and looks
   deployed. The backfill is the reconcile rather than a script — SF11's
   `backfill-pulse-counts.mjs` exists and was never run, and a scheduled job needs
   no operator and no credentials. **Until its first run, Pulses that predate the
   counter read as 0 and stay uncapped** (asserted in `rules/security.test.ts`, so
   it is a decision on the record rather than a surprise), and any Pulse already
   over its tier cap will begin refusing new resources once the true count lands.
   The `get()` budget §8.2 warned about was measured, not assumed: 103 rules tests
   pass with the quota check in place.
1. **Masters + copy into a Pulse**, the bulk path as a callable (RM15), with
   linking by email and the two resolution triggers (RM16). `masterId` and
   `linkedEmail` written from the very first copy, even though nothing propagates
   yet — retrofitting provenance onto copies that already exist means guessing.
   The email is stored in the clear (RM19).
2. **Usage index + "where used"**, with the RM7 disclosure implemented as decided.
3. **Teams**, grouping only.
4. **Team sharing**, two levels, same workspace.
5. **Propagation** switched on, per RM2's classes.
6. **Master rates** — last, because it is the one that touches money and the one
   whose propagation can be wrong in currency (§7).

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
2. **RM2 — Propagation is per-field, in four classes → DECIDED.** *Always*
   (identity: name, initials, type, avatar, **`linkedEmail`**); *never* (capacity
   and allocations, which are per-Pulse by nature); *unless overridden* (rate,
   §7); *derived* (**`linkedUid`**, computed locally per §5 and never pushed down
   — a master's uid would assert a Pulse membership that may not exist).
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
6. **RM6 — A link is to an EMAIL; the uid is resolved state → DECIDED (§5).**
   `linkedEmail` is what someone meant; `linkedUid` is what it resolved to once
   that person had an account with access. Normalised with the existing
   `emailKey()` (trim + lowercase), the same canonical form invites already use
   and that the rules compare against `request.auth.token.email.lower()`.
   **Linking still grants no access** — that remains `pulseMembers`, and a link to
   a non-member is inert.
   *Rejected: `linkedUid` as the link* (this spec's first draft) — it cannot name
   someone who has not joined yet, which is the normal case for a roster, and it
   put SF7's clear-on-removal in direct conflict with master propagation, so a
   link would resurrect after being cleared. Splitting intent from resolution
   makes that same behaviour correct rather than a bug, and the conflict
   disappears rather than being worked around.
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
   The copy carries `inherited` because "equals the master because it was copied"
   and "typed here on purpose" are the same bytes, and a stale rate is wrong
   money rather than a wrong label. Master changes refresh only inherited copies;
   editing a Pulse's rate ends its tracking permanently.
   *Rejected: resolving the rate server-side per request* — heavier, and it makes
   every cost view depend on a function being up. *Rejected: propagating rates
   unconditionally* — it silently reverses a deliberate commercial decision (a
   discount, a frozen quote) with nothing on screen to explain why the number
   moved.
10. **RM10 — `maxResourcesPerPulse` gets a server-owned counter and a rule →
    DECIDED (§8).** It is enforced **only in the client** today
    (`src/domain/entitlements.ts:16`); no rule counts resources in a Pulse, so any
    direct write ignores it. Already reachable without masters — `duplicatePulse`
    in full mode copies every resource from the source — and a "copy this team in"
    button makes it a single click. `pulses/{id}.resourceCount` on the SF11
    pattern (`functions/src/counters.ts`): **recount with `count()`, never
    `increment`**, because triggers are at-least-once and an incremented counter
    drifts upward forever. Server-owned, added to `SERVER_COUNTERS()`
    (`firestore.rules:40`) so a client cannot zero its own gate.
    *Rejected: relying on the client gate* — it is the thing that is already
    failing. *Rejected: `increment`* — see above; the recount is idempotent and
    self-healing.
    Two traps recorded so they are not rediscovered: the rule must fit inside the
    per-request document-access budget (measure it, or denormalize the limit onto
    the Pulse instead), and an absent counter reads as **zero**, so every existing
    Pulse is uncapped until backfilled — SF11's own backfill was specified and
    never run. Deploy order is counter → backfill → rule → UI.
11. **RM11 — Phase in the order of §11 → DECIDED.** Provenance (`masterId`) is
    written from the first copy even though nothing propagates until phase 5,
    because retrofitting it onto copies that already exist means guessing which
    of them came from where. Note the corrected scope: the `inherited` marker
    belongs to the **rate document** (RM9), which is the only unless-overridden
    field — an earlier draft put an array on the resource that would have marked
    nothing.

12. **RM13 — Deleting a master DETACHES its copies; it never deletes them →
    DECIDED (product).** A Pulse's plan must not lose its people because someone
    tidied the roster, and a deleted person's past work still has to cost and
    report correctly. So `masterId` is cleared on every copy and each Pulse is
    left intact and self-sufficient. Consequence: **`masterId` never dangles**, so
    no reader has to handle a pointer to a missing master.
    **The detach is two documents, not one.** Clearing `masterId` on the resource
    stops identity propagation, but the rate lives in a *different* collection
    (§7) — and a rate doc still marked `inherited: true` with no master to inherit
    from is a dangling reference in the one place where a mistake is denominated
    in currency. So detaching must also clear `inherited` on
    `pulses/{id}/rates/{resourceId}`. The same applies to a manual detach.
    *Rejected: cascade-deleting the copies* — it destroys plan data in Pulses the
    person deleting the master may not even be able to open. *Rejected: refusing
    to delete a master that is in use* — it makes the roster un-tidyable, and RM7's
    usage index already tells you where it is used if you want to look first.

14. **RM15 — Bulk copy is a server callable, not a client loop → DECIDED (§8.3).**
    The counter is written asynchronously, so a parallel write of twenty resources
    has all twenty evaluated against the same stale count and all twenty pass. The
    rule would stop the twenty-*first* copy operation and none of the writes inside
    it. SF11 accepts that convergence gap for Pulse creation because a burst is an
    edge case there; for "copy this team in" **the burst is the normal path**, so
    the same trade does not carry over. A callable reading the count, checking the
    tier and writing with the Admin SDK is the only place the check and the writes
    are ordered. *Rejected: a client-side batch under the rule* — it is precisely
    the case the rule cannot see. Single ad-hoc adds stay client-side, where
    eventual convergence is the right trade.
15. **RM16 — Resolution happens on arrival, via two triggers → DECIDED (§5.3).**
    Someone joining the **workspace** resolves `linkedUid` on master resources
    matching their email; someone joining a **Pulse** resolves it on that Pulse's
    resources. Both are bounded queries on an email that has just become usable.
    This is what closes the loop for a master copied into a Pulse ahead of its
    person: the resource waits with an email and no uid, and works the moment they
    accept. *Rejected: resolving lazily on read* — every reader would need write
    permission to persist the result, and `assignedUids` (SF1) is derived from the
    stored uid, so a lazily-resolved link would never reach the rules that use it.
    Requires **`WorkspaceMember` to gain a denormalised `email`** — it has none
    today (`{uid, role, joinedAt}`), unlike `PulseMember` — so the first trigger is
    one query rather than a member read plus a `users/{uid}` lookup.
16. **RM17 — Removal clears the resolution; only a deliberate unlink clears the
    intent → DECIDED (§5.4).** SF7 (`functions/src/cascade.ts:65`) keeps clearing
    `linkedUid` when a member is removed, but stops there: `linkedEmail` survives,
    so re-inviting that person re-resolves the link. A membership change is not a
    statement about who a resource *is*. An explicit unlink clears both, because
    that is such a statement. *Rejected: SF7 clearing both* — it silently discards
    roster intent on a temporary access change, and on a master-linked resource
    the next propagation would restore the email anyway, so the clear would not
    even hold.
17. **RM18 — Hand-made links stay collaborator-only; master-derived links may name
    a non-collaborator → DECIDED (§5.2).** The Team tab dropdown keeps offering
    only current collaborators (`TeamTab.tsx:215`), while a copy from a master
    brings whatever email the roster holds. The asymmetry is deliberate and worth
    stating before someone reports it as a bug: a hand-typed address invites
    typos and phantom links that never resolve, whereas a master-derived one has a
    curated roster behind it and a resolution path (RM16) that will complete on
    its own.
18. **RM19 — A Pulse resource stores the linked email in the clear, including for
    someone who is not a collaborator → DECIDED (product).** Required for RM16:
    the address is what resolution matches on when that person later joins.
    **The disclosure is deliberate and stated so nobody discovers it as a
    surprise:** resource documents are readable by every Pulse member, so copying
    a master into a Pulse shows staff email addresses to any collaborator on that
    Pulse — including an external one invited to that project alone. Accepted
    because a person on a Pulse's roster is part of that project's team, and
    appearing as such is what the field is for. *Rejected: storing only a hash* —
    it still resolves, but the UI can then never say who a resource is waiting
    for, which turns an unresolved link into an unexplained blank. *Rejected:
    storing the email only once it resolves* — it breaks precisely the case RM16
    exists to serve, a master copied in ahead of its person.
19. **RM20 — A Pulse distinguishes live links from waiting ones, derived rather
    than stored → DECIDED (§5.6).** Three states, read straight off the two fields
    of §5: no `linkedEmail` is a placeholder; `linkedEmail` + `linkedUid` is a
    current collaborator; `linkedEmail` without a uid is rostered but **not a
    collaborator on this Pulse**. Without the distinction a roster copied from a
    master looks like a fully staffed team when half of it cannot open the Pulse.
    *Rejected: an `isCollaborator` flag* — it would say the same thing while being
    able to drift from it, and the derivation is already exact and self-maintaining
    (RM16 sets the uid on join, RM17 clears it on removal).
    The label states what is true of *this Pulse*, not what it guesses about the
    person: "not a collaborator here" covers both "has an account but was never
    invited" and "has no account yet", which a Pulse cannot tell apart without
    reading a user document it has no right to read. Surface the consequence too —
    a waiting link means no My-Beat visibility and no notifications, because SF1's
    `assignedUids` has no uid to carry. Offering the invite from that row is the
    natural affordance, and the mirror of RM14.
20. **RM21 — The roster gets three MCP tools, and they inherit permissions →
    DECIDED (§10).** `search_roster` (phase 1), `get_resource_usage` (phase 2),
    `list_teams` (phase 3). Named to separate cleanly from the Pulse-scoped
    `search_resources`, because two tools whose descriptions overlap is how an
    assistant picks the wrong one. No new authorization: the service reads as the
    customer, so a non-workspace-member gets a 403 that becomes an empty result,
    and master rates stay behind their own workspace-owner-only collection — with
    the same "empty may mean no access" note the cost tools already carry.
    `get_resource_usage` will name Pulses the caller cannot open, per RM7; its
    description must say so, because an assistant stating it aloud is more
    startling than a list showing it. *Rejected for now: cross-Pulse people load*
    — the most valuable question the roster makes askable and the most expensive,
    N Pulses × the per-Pulse read cost against tools already capped at 200
    documents. Wait for evidence of demand, then build a purpose-made aggregate
    rather than fanning out `get_people_load`.

## Open

- **RM12 — Does the master roster have its own quota?** Per-Pulse caps still
    apply on copy, so the exposure is storage rather than entitlement.
    *Recommend: no master cap initially*, and revisit if a workspace ever holds an
    unreasonable roster. Tiers differ only by quantity (`Plans-Spec.md` §3), so if
    a cap is added it must be a quantity, not a feature gate.
- **RM14 — Request access.** A linked user who can see they are staffed on a
    Pulse they cannot open should be able to ask. Out of scope for phase 1;
    listed because RM7's disclosure was accepted partly on the strength of it, and
    a decision that leans on a future feature should say so.
