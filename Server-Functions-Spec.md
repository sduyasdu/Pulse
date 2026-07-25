# Pulse — Server Functions Spec

Status: **Registry — open** · Owner: product + eng · Related: `Permissions-Spec.md`, `Collaboration-Spec.md`

## 0. Purpose

Pulse ships **fully serverless today**: a React client talking directly to Firestore
(+ Firebase Auth + Hosting). There are **no Cloud Functions** yet.

This document is the **single registry for every capability that is deferred to
server-side execution** — the "server-delayed" decisions from the other specs. For
each such capability the client does the work as an **interim** (good enough for v1),
and this doc records the **target server design** plus the interim, so the migration is
a known, bounded piece of work rather than a scattered set of TODOs.

**Rule of thumb:** whenever another spec says "…do this on the server / a Cloud
Function later", it must **not** leave that as a loose open decision — it adds an entry
here (an `SF#`) and references it. See §4 (Adding an entry).

## 1. Platform & conventions

- **Runtime:** Firebase Cloud Functions (2nd gen), TypeScript, deployed to the same
  `pulse-b9d96` project. Triggered by Firestore document writes
  (`onDocumentWritten`/`onDocumentCreated`) unless noted.
- **Idempotency:** every function must be safe to run twice on the same event (Firestore
  delivers at-least-once). Recompute-from-source and write the result; never increment.
- **Authority:** a server function is the *authoritative* maintainer of any field it
  owns. Once a function ships, the client stops writing that field (or writes it only as
  an optimistic hint the function overwrites).
- **Interim before it ships:** the client maintains the field/behaviour. The interim is
  acceptable only where a wrong/stale value **fails closed** (denies access) rather than
  leaking — noted per entry.
- **Cost:** these are low-frequency, write-triggered functions; keep them off any
  read/hot path.

## 2. Registry

| ID | Function | Owns | Trigger | Referenced by | Status |
|---|---|---|---|---|---|
| **SF1** | Feature denormalization maintainer | `Feature.assignedUids`, `Feature.leadUid` | write of features / resources / subtasks | `Permissions-Spec.md` §4.2, §7, P2/P12 | Deferred (client-maintained interim shipping) |
| **SF2** | Assignment & comment notifications | server-authored `notifications/*` (dedupe, batching, email later) | write of features (assignment) / comments | `Collaboration-Spec.md` §3.6 | Deferred (client-created notifications interim) |

---

## 3. Function specs

### SF1 — Feature denormalization maintainer

**Owns:** the two scalar fields the permission rules read to enforce the scoped roles:
- `Feature.assignedUids: string[]` — the linked account uid of **every** resource
  assigned to the feature **or any of its subtasks** (`Resource.linkedUid` for each
  `resources[]` entry, deduped; excludes unlinked resources).
- `Feature.leadUid: string | null` — the linked account uid of the resource in
  `feature.lead` (or `null` if unset / the lead resource is unlinked).

**Why server-side (target):** these are derived from data on other documents
(`Resource.linkedUid`) and from arrays the rules can't iterate. A function guarantees
they stay correct across **all** the events that change them, atomically, regardless of
which client made the change — including the **`linkedUid` fan-out**: when a resource is
linked/unlinked to an account, *every* feature that resource appears on (directly or via
a subtask, or as `lead`) must be recomputed.

**Triggers (onDocumentWritten):**
1. `pulses/{p}/features/{f}` — recompute that feature's `assignedUids`/`leadUid` from its
   own `resources`, `children[].resources`, and `lead`. (Skip if the write was the
   function's own denorm-only update — compare before/after to avoid loops.)
2. `pulses/{p}/resources/{r}` — if `linkedUid` changed, **fan out**: find every feature
   in the Pulse whose `resources`, any `children[].resources`, or `lead` references `r`,
   and recompute each. (Read the Pulse's features once; batch the updates.)

**Algorithm (per feature):**
```
assignedUids = unique( [ ...resources, ...children.flatMap(c => c.resources) ]
                         .map(rid => resourceById[rid]?.linkedUid)
                         .filter(Boolean) )
leadUid      = resourceById[feature.lead]?.linkedUid ?? null
```
Write only when the computed values differ from the stored ones (idempotent, no loop).

**Interim (ships now — Permissions-Spec P12 resolved to client-maintained):** the
client writes `assignedUids`/`leadUid` on every feature write, and performs the
`linkedUid` fan-out from the linking client (it already has the full resource roster in
`pulseStore` and already fans out `myResourceIds`). Safe because only **editors**
(`editScope:'all'`) can write features — a scoped-role user can't write features and so
can't forge their own inclusion/lead; and a stale denorm **fails closed** (a My-Beat
Viewer sees *fewer* tasks, never more). The only real gap the interim leaves is the
fan-out being interrupted mid-write (partial update) — which SF1 removes.

**Migration:** ship the client interim first (Permissions phase 2 backfills existing
features). When SF1 deploys, it becomes authoritative; the client keeps writing the
field optimistically (SF1 reconciles) or stops — decided at SF1 build time.

**Acceptance:** for any feature, `assignedUids`/`leadUid` equal the algorithm output
within one function invocation of any assignment/lead/`linkedUid` change; a resource
unlinked from an account is removed from every affected feature's `assignedUids`.

### SF2 — Assignment & comment notifications (placeholder)

Notifications are **currently created client-side** (`src/components/comments/notify.ts`,
`services/firestore/notifications.ts`). `Collaboration-Spec.md` §3.6 anticipates moving
notification authoring server-side for reliability, de-duplication, batching, and
(later) email/push. Captured here so it isn't a loose end; **not scheduled** — expand
into a full SF spec when notifications move server-side. If SF1 and SF2 ship together,
share the features-write trigger.

---

## 4. Adding a server-delayed decision

When any spec would defer work to the server:
1. Add a row to the §2 registry (`SF#`, what it owns, trigger, referencing spec).
2. Add a short §3 entry: target server design + the interim client behaviour + why the
   interim is acceptable (must fail closed if it's security-relevant).
3. In the source spec, resolve the open decision to **"client-maintained now; server
   hardening tracked as Server-Functions-Spec SF#"** and link here — don't leave it as a
   standalone open decision.
