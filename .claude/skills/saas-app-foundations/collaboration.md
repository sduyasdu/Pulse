# Collaboration


Multi-user is not a feature you add to a single-user app. It changes who may
write what, whose data you are allowed to touch, and what "delete" means. Decide
these before the second user exists.

## 4.1 Authorization: derive capabilities from the role

Store the **role**; derive what it can do. Do not read a client-writable
capability bag to decide what the client may do.

```
// rules — capabilities derived from the role for fixed presets
role in ['owner','editor']   → full edit
role == 'taskLead'           → edit only what they lead
role == 'custom'             → only here, consult the stored caps
```

The reason is specific: if someone joins through an invite link and the rules
trust a `caps` field on their own membership document, they can write themselves
a better one. Presets must be role-derived so the only escalation path is
someone with authority changing their role.

Two invariants worth encoding from the start:

- **Somebody must always be able to administer the resource.** Guard against the
  last owner removing themselves — and remember the guard has to survive
  teardown, where the resource is being deleted legitimately.
- **Effective permission is the *intersection* of every axis** — plan
  entitlement ∧ role capability ∧ resource lifecycle state (archived, locked,
  read-only). Compute it in **one place** and let every disabled state, drag
  guard, hidden control and keyboard shortcut read that. Scatter it and they
  drift, and the one you forget is the security-relevant one.

## 4.2 Shared state and per-user state are different features

The clearest trap in collaborative UI. Two superficially similar actions:

| | Scope | Who notices |
| --- | --- | --- |
| **Archive** | shared — read-only for everyone | every member |
| **Hide** | per-user — off *my* list only | nobody else |

Conflating them means one person tidying their dashboard silently freezes a
resource for the whole team. Name them differently, store them in different
places (shared state on the resource; per-user state under the user), and decide
their precedence explicitly when both apply.

Related: an archived/frozen resource must stay **deletable** by its owner, or the
freeze makes it permanent. Any write restriction you add gets checked against
teardown.

## 4.3 Some cleanup is server-mandatory

A client **cannot** delete another user's documents — their copy of the
dashboard index, their presence record, notifications addressed to them. Rules
correctly forbid it, and no amount of client code gets around it.

So membership removal, resource deletion and account deletion need **server
functions**. This is not later hardening; there is no client-side interim, and it
is a day-one cost of being multi-user. Budget for it when choosing the
architecture (`architecture.md` §1.1) — "do I need server compute" is answered *yes* by
collaboration alone, whatever else you decide.

Make each one idempotent: re-running a cleanup must find nothing left to do.

## 4.4 Per-user indexes are convenience, never security

"List everything I have access to" is awkward in a rules-based datastore, and
cross-collection queries may be rejected outright. The workable pattern is a
denormalized per-user index — a document per user listing what they can see —
that they query directly.

The rule that makes it safe: **every actual read of the underlying data is still
re-checked against the real membership record.** The index only decides what
appears in a list. A corrupted entry then shows one person a broken card on their
own dashboard; it never grants access.

Because the index is a copy, it goes stale — someone else renames the resource,
or your membership was revoked. Give it a **self-heal pass** that reconciles
against the source on load and writes only on a real difference, so it converges
instead of looping.

## 4.5 Undo is per-user and in-memory

You cannot undo someone else's change, and a shared undo stack in a live
document is a research project. Scope undo to the current user, the current
resource, and the current session; drop it on navigation. Decide this early —
it is much harder to remove a shared-undo assumption later than to add scope now.

## 4.6 Presence, comments and notifications

- **Presence is ephemeral.** Treat it as disposable, expect stale entries from
  closed tabs, and clean it up server-side when membership ends (§4.3).
- **Mentions need a target model.** Decide what can be @-mentioned — people,
  or the domain objects people care about — and store mentions **structurally**
  (kind + id + label) rather than parsing text later. In Pulse you mention a
  *resource*, which means "mentions me" resolves to "mentions a resource linked
  to my account" — a definition worth writing down, because filters and
  notifications both depend on it.
- **Notifications are addressed to a user**, so they live under that user, so
  cleaning them up is server-mandatory. Same category as §4.3.

## 4.7 Invites

Pin the granted role **to the invite**, not to the joiner's request — otherwise
accepting an invite is a role-selection screen. An email invite must be matched
against the accepting account's *verified* address, and a link invite grants
exactly the role the link encodes.

Give link invites a revocation path, and expect one active link at a time to be
simpler to reason about than a set.
