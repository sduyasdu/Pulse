# Pulse — Costs Spec (cost types, AI tokens & pricing)

Status: **AI costing shipped. People costing (§8) ready to build — CO13/17/20 resolved; CO14–CO16, CO18, CO19 open; CO1/3/6/12 open (implementation-level)** · Owner: product + eng ·
Related: **`Costs-Build-Plan.md`** (phased implementation plan),
`Pulse-Product-Spec.md` (§3 Core entities, §6 Resource & assignment views),
`Permissions-Spec.md` (capabilities), `Plans-Spec.md` (entitlement gating),
`Changelog-Spec.md` (activity entries), `Server-Functions-Spec.md` (future rollups)

## 0. What this is (and isn't)

This spec adds a **cost layer** to a Pulse: what a task costs in money, how that
money is measured, and how it reads across time.

The central decision: **cost is not a kind of Resource.** A Resource stays what §3
of the product spec says it is — a person with capacity and assignments. Cost is a
**separate, typed entity** that attaches to a task. "AI" is a *cost type*, not a
teammate — and so is "People".

That framing is what makes the layer extensible. **`ai` is built and shipped**;
**`people` (§8) is specified here and not yet built.** People cost is derived from
assignments rather than entered, and its rates are admin-only, but it reuses the same
view, proration, totals and audit path — which is the claim the two-type design was
making.

### 0.1 The standard of accuracy — directional, not accounting-grade

**The goal is to give a PM an idea of what a roadmap costs, not to produce figures
anyone could invoice or audit against.** This is the spec's guiding constraint, and
it is what makes several decisions below coherent instead of arbitrary:

- **CO2** — one blended `tokens` measure, so the derived $/Mtok mixes input and
  output rates. Fine: the money entered is real, only the per-unit figure is coarse.
- **CO4** — no price table. Unit cost comes from what was actually spent.
- **CO17** — labour is derived from the schedule, so a total may add AI *actuals* to
  labour *plan*. Accepted; it answers "roughly what will this cost", which is the
  question being asked.
- **CO20** — one current rate per person, applied across all time. A raise moves
  historical figures. Accepted.

Anything that would require exactness — timesheets, effective-dated rates, closed
periods, invoicing — is deliberately out of scope. If that need ever arrives it is a
different feature with a different name, not a tightening of this one. §8.9 and §8.10
record the specific inaccuracies this buys, so nobody has to rediscover them.

What this spec also does *not* cover: budgeted/estimated cost (**CO9**), invoicing
the customer, multi-currency (**CO8**), and the Pulse's own subscription billing —
that's `Plans-Spec.md`, a different axis entirely (what the *owner pays Pulse*, not
what a *project costs*).

## 1. Model at a glance

```
CostTypeDef  (registry — "ai" and "people")
  ├─ measures[]    what quantity is counted, and at what price scale
  │                  ai:     tokens  (unit cost quoted per 1M)
  │                  people: hours   (unit cost quoted per 1)
  ├─ attributes[]  type-specific fields
  │                  ai:     brand, model, resource (who used it)
  │                  people: resource (whose hours) — rate from rates/{id}
  └─ basis         how money and unit cost relate (§3)
                     ai:     amount → unit cost derived
                     people: rate   → amount derived

CostEntry    (pulses/{id}/costs/{costId}) — one recorded cost
  ├─ typeId        → CostTypeDef
  ├─ featureId     → the task it belongs to (required — CO5)
  ├─ quantities    per measure: 1_240_000 tokens
  ├─ amount        what was actually spent: $412
  ├─ (unit cost)   derived, never stored: $332/Mtok  (§3)
  └─ attrs         brand: "anthropic", model: "claude-opus-5", resourceId: "…"

Cost view    (§6) — bottom panel, alternate to Assignment by resource
             rows = type › (pivot) › … expandable; columns = day/week/month
             periods; money prorated across the task's span (§5)
               ai:     model › person › task
               people: person › task          (admins only — §8.7)

ResourceRate (pulses/{id}/rates/{resourceId}) — $/h, admin-readable only.
             NOT a field on Resource: rules are per-document (§8.3).
```

## 2. Cost types

A cost type is a **definition**, not data: it declares what a cost of that kind
measures, what attributes it carries, and how it prices.

```ts
/** "ai" ships built-in; "people" is specified in §8, not yet built. */
export type CostTypeId = string;

/** One thing a cost type counts. `priceScale` is how many units a unit cost is
 * quoted over — 1 for hours ($/h), 1_000_000 for tokens ($/Mtok) — so the figure
 * stays human-readable instead of $0.000332. */
export interface CostMeasureDef {
  id: string;          // "tokens" | "hours"
  label: string;       // i18n key, not a literal (§9)
  unit: string;        // "tokens" | "h"
  priceScale: number;  // 1_000_000 | 1
}

/** A type-specific field on an entry. `inheritFrom` pulls the default off the
 * referenced Resource master rather than asking the user (§8). */
export interface CostAttributeDef {
  id: string;                       // "brand" | "model" | "resourceId"
  label: string;
  kind: "enum" | "text" | "resourceRef";
  options?: string[];               // for kind: "enum"
  required?: boolean;
  inheritFrom?: "type" | "capacity" | "hourlyRate";
}

export interface CostTypeDef {
  id: CostTypeId;
  label: string;
  measures: CostMeasureDef[];
  attributes: CostAttributeDef[];
  defaultBasis: CostBasis;          // §3
  /** Ordered attribute ids the Cost view nests under the type row. AI:
   * ["model", "resourceId"] → type › model › person (CO7). */
  groupBy?: string[];
  color: string;                    // row/legend tint
}
```

**Where the registry lives (CO1).** Built-in types are code
(`src/domain/costTypes.ts`), the way `DEFAULT_STATUSES` is — they carry logic
(price scales, inheritance) that doesn't belong in user data. A Pulse may
*override prices* (§4) but not invent a type in this phase. *Recommend: code
registry now; `Pulse.costTypes?: CostTypeDef[]` later if user-defined types are
wanted, mirroring how `Pulse.statuses` extends `DEFAULT_STATUSES`.*

### 2.1 The AI cost type (built and shipped)

| Field | Value |
|---|---|
| `id` | `"ai"` |
| `measures` | **`tokens`** — one measure, quoted per 1M (**CO2 resolved**) |
| `attributes` | `brand` (enum), `model` (text + suggestions), `resourceId` (resourceRef — *the human who used it*) |
| `basis` | **always `"amount"`** — you enter tokens and what was spent; unit cost is derived (**CO4 resolved**) |
| `groupBy` | `["model", "resourceId"]` — type › model › person (**CO7 resolved**) |

- **`brand`** — the AI vendor: `anthropic`, `openai`, `google`, `meta`, `mistral`,
  `xai`, `deepseek`, `other`. Enum so the view can group and colour consistently;
  `other` + free-text `model` keeps it open-ended.
- **`model`** — free text with per-brand suggestions (e.g. `claude-opus-5`,
  `gpt-5`). Free text on purpose: model names ship faster than we do, and a
  hardcoded enum would reject a model the day it launches.
- **`resourceId`** — the **human who used the AI**, a real `Resource` id. This is
  the join that makes AI spend attributable to a person without making the AI a
  person: "Santiago spent $412 of Opus on Conciliaciones." Optional — unattributed
  AI spend on a task is still valid.

**One token measure (CO2 resolved).** A single `tokens` quantity, not an
input/output split. This works precisely *because* AI entries are amount-based
(CO4): the money is entered, not computed from a rate, so the input/output mix
never has to reconstruct it — it would only change a display figure. The
consequence to accept: the derived unit cost is a **blended** $/Mtok across
whatever mix the entry covers, and two entries on the same model can legitimately
show different unit costs. That's a fair reading of reality, not an error.

Splitting later is additive — a second measure on the type def, with existing
entries' `tokens` reading as the total.

## 3. Measures, money, and which side is derived

Three numbers, always: **quantity**, **unit cost**, **amount**. Any two determine
the third, and which two the user actually knows differs by type. That's the
`basis`:

```ts
export type CostBasis = "rate" | "amount";
```

| Basis | Known | Derived | Used by |
|---|---|---|---|
| `"amount"` | quantity + amount | **unit cost** = amount ÷ (qty ÷ priceScale) | **AI (this phase)** — $412 over 1.24M tokens ⇒ $332/Mtok |
| `"rate"` | quantity + unit cost | **amount** = qty ÷ priceScale × unitCost | People (§8, not built) — 32 h × $85/h = $2,720 |

Rules:

- **AI is always `"amount"`** (CO4): there is no price table to rate against, so
  the unit cost is *always* calculated from actuals. **`people` is always `"rate"`**
  (§8.4): hours × $/h. One field, two types, one view — this is what the basis
  discriminator was for.
- **`basis` is stored per entry**, defaulted from the type, so a rate-priced entry
  can appear later without a schema change.
- **The derived value is computed, never stored.** Storing all three numbers
  invites them to disagree; a domain function derives on read
  (`src/domain/costs.ts`, pure, no React/Firestore — same discipline as
  `graphEffort.ts`).
- **Division by zero** — quantity 0 under `"amount"` yields a `null` unit cost,
  rendered `—`, not `0` or `Infinity` (`theoreticalElapsed` sets the precedent:
  null when the denominator is meaningless). The amount still counts in every
  total; only the per-unit figure is unavailable.
- **Multiple measures on one type** is supported by the shape but unused: `ai` has
  one (`tokens`), `people` has one (`hours`). How a single amount would split across
  several measures is deferred (**CO3**).

### 3.1 Precision

Money is stored as **integer micro-dollars** (`amountMicros`, 1e-6 USD). Floats
drift once you prorate a total across 23 working days and re-sum it, and cents are
too coarse: a per-token cost is around $0.000003. **Round only at render**; keep
every intermediate in micros.

Unit cost, being derived, is never stored — it's computed at `priceScale` (per 1M
tokens), where the figure is human-scale and precision never bites.

## 4. No price table (CO4 resolved)

**There is no rate card, and none ships with vendor prices.** Unit cost is always
calculated from actuals: you enter the tokens and the dollars, and $/Mtok falls
out.

Why this is the right call and not just the cheap one:

- Published model prices change often, and change *retroactively* in the sense that
  a table updated today would silently reprice work recorded months ago. A stale
  table quietly mispricing a roadmap is worse than no table.
- Real spend rarely equals list price anyway — commitments, discounts, batch and
  cache tiers all move it. Actuals are the only figure that's true for *your*
  account.
- It removes a whole maintenance surface: no catalog to curate, no per-Pulse
  overrides, no "which price applied on which date" question.

What this costs, stated plainly: **you cannot forecast an AI cost from a token
estimate**, because nothing knows what a token costs until you've spent some. If
forecasting is wanted later, the natural move is to derive a blended rate from that
Pulse's own history (last N entries for the model) rather than reintroduce a
catalog — and it pairs with CO9's estimate entries.

Rate cards return only with the human cost type (§8), where an hourly rate is a
property of the person and lives on the Resource master, not a vendor list.

## 5. Recording costs, and prorating them across time

```ts
export interface CostEntry {
  id: string;
  typeId: CostTypeId;
  /** The task this cost belongs to. Required — every cost hangs off a task
   * (CO5), which is also what gives it a span to prorate over and a permission
   * scope to inherit. */
  featureId: string;
  quantities: Record<string, number>;   // measureId -> quantity ({ tokens: 1_240_000 })
  basis: CostBasis;                     // "amount" for every AI entry (§3)
  amountMicros: number;                 // what was spent, in 1e-6 USD
  /** Unit cost per measure, only when basis="rate" (§8's human type). Absent on
   * AI entries, where unit cost is derived from amount ÷ quantity. */
  unitCosts?: Record<string, number>;
  currency: "USD";                      // CO8 resolved — USD only
  attrs: Record<string, string | null>; // brand/model/resourceId for ai
  /** When it happened. See the resolution order below. */
  at?: number | null;                   // day index (dateUtils epoch), a point cost
  spanStart?: number | null;            // explicit range, [start, end)
  spanEnd?: number | null;
  note?: string;
  createdBy: string;
  createdAt: Timestamp;
  /** Mirrors Feature.assignedUids at write time so My-Beat readers can be
   * scoped in rules without a join (Permissions-Spec §4.2). */
  scopeUids?: string[];
}
```

Stored at **`pulses/{pulseId}/costs/{costId}`** — a sibling of `features` and
`resources`, not a field on the Feature. Costs are append-heavy and unbounded
(hundreds of AI sessions on one task); an array on the feature doc would collide
under concurrent writes and eventually hit the 1 MiB document ceiling.

### 5.1 The span a cost occupies

Resolution order, first match wins:

1. `spanStart`/`spanEnd` set → that range.
2. `at` set → the single day `[at, at+1)` — a **point cost**.
3. Otherwise → the parent feature's `[x, x + duration)`. **This is the prorated
   case**: a task-level total with no date of its own.

There is no fourth case: `featureId` is required (CO5), so every entry always
resolves to a span. A cost can never fall out of the period columns — which is
also what makes the bottom Total row trustworthy.

**Dragging a task moves its money.** Because case 3 reads the feature's current
`x`/`duration`, re-scheduling a box re-prorates its undated costs automatically —
no stored copy to go stale. Point costs (`at`) stay put, which is the right
behaviour: a session that happened on Jul 9 happened on Jul 9 regardless of where
the box moves.

### 5.2 Proration

> The total amount of $ for the task is spread across the task's span, so a
> per-period view shows money where the work was, not a spike on the day someone
> typed it in.

Algorithm — deliberately the same shape as `allocInRange` in
`src/domain/assignments.ts`, which already spreads allocation day-by-day and
aggregates into periods:

1. Take the entry's span (§5.1).
2. **Eligible days** = working days in that span — weekends excluded unless the
   parent feature's `useWeekends` is set, via `businessInSpan`. Consistent with
   Elapsed Time in the Graph Effort model (§4 of the product spec): money follows
   the same calendar as effort. If the span contains zero working days, fall back
   to calendar days so the amount is never silently dropped.
3. **Per-day amount** = `amountMicros ÷ eligibleDays`, on each eligible day.
4. **Period cell** = Σ per-day amounts for days in `[period.start, period.end)`,
   where periods come from `buildPeriods(density, startDay, endDay)` — the exact
   function the assignment panel uses, so day/week/month bucketing matches
   everywhere.
5. Accumulate in micros; round once, at render.

Point costs (`at`) skip steps 2–3 and land whole in one period. Partial overlap at
the window edges falls out of the day-level accumulation for free.

## 6. The Cost view

An **alternate view to the Assignment-by-resource panel** — same bottom panel, same
resizable height, same time axis. A segmented control in the panel header switches
between them:

```
┌────────────────────────────────────────────────────────────────────────┐
│ [Assignment by resource] [Cost]         filter: types▾ models▾ people▾ │
├────────────────┬───────────┬───────────────────────────────────────────┤
│                │ TOTAL(all)│  Jul 6   Jul 13   Jul 20   Jul 27   Aug 3 │ ← shares the
├────────────────┼───────────┼───────────────────────────────────────────┤   canvas ruler
│ ▾ AI           │ ‹ $6,240  │   $940    $1,120    $980   $1,020   $752  │
│   ▾ opus-5     │ ‹ $3,980  │   $610     $730     $640    $660    $500  │
│       SDU      │ ‹ $2,900  │   $450     $530     $460    $480    $360  │
│       MJ       │   $1,080  │   $160     $200     $180    $180    $140  │
│   ▸ gpt-5      │   $2,260  │   $330     $390     $340    $360    $252  │
├────────────────┼───────────┼───────────────────────────────────────────┤
│ TOTAL          │ ‹ $6,240  │   $940    $1,120    $980   $1,020   $752  │ ← sticky footer
└────────────────┴───────────┴───────────────────────────────────────────┘
   the ‹ marks spend outside the visible window — the Total column is all
   time (CO11), so it deliberately exceeds the cells beside it ($4,812 here)
```

- **Three levels: type › model › person** (CO7), from the type's ordered
  `groupBy: ["model", "resourceId"]`. The person level answers the question that
  always follows the first look at an AI bill — *who is spending this?* — and it's
  free, because `resourceId` is already on the entry. Entries with no attributed
  person collect under an "unattributed" child rather than vanishing.
- Person rows show the **`ResourceBadge`**, so a linked account appears with its
  avatar exactly as everywhere else.
- **Columns = periods**, driven by the canvas `density` (day / week / month) and
  the visible `[startDay, endDay]` window — the panel already receives `offsetX`,
  `dayWidth`, `viewZoom`, `density`, `startDay`, `endDay` and stays time-aligned
  with the canvas. Reuse all of it.
- **Total column on the left**, before the period cells. **Total row at the
  bottom**, sticky, with the grand total in the corner cell.
- Cells are money, tinted by magnitude within the row so the expensive periods pop
  without reading digits. Empty cells render blank, not `$0` — a grid of zeros is
  noise.
- **Filters**, mirroring the assignment panel's affordances: by type, by model, by
  resource (the human attributed), by task/status; plus *hide empty rows*. Reuse
  `MultiSelectFilter`.
- Selecting a task on the canvas scopes the view to that task's costs, the way
  selecting a box scopes the assignment panel to its crew.

### 6.1 Where the Total column actually goes (CO10 resolved)

A real conflict, worth naming.

The bottom panel is split into two zones: a **fixed-width label column** on the
left (avatar, name, load bars) and the time axis filling everything to its right.
That width is `labelWidth` in `AssignmentPanel.tsx` — used both as a spacer above
the ruler and as each row's first cell — and it is what keeps the panel's calendar
aligned with the canvas's: both start their time axis at the same x offset, so
"Jul 20" in the panel sits directly under "Jul 20" on the canvas.

A Total column inserted *between* the labels and the timeline pushes that origin
right, and the two calendars stop lining up:

```
Option A — the total lives inside the label column  (recommended)
├──────────── labelWidth ─────────────┤
┌──────────────┬──────────────────────┬────────────────────────────────
│ ▾ AI         │             ‹ $6,240 │  $940   $1,120   $980   ...
└──────────────┴──────────────────────┴────────────────────────────────
                                       ↑ time axis starts here — same x
                                         as the canvas above ✓

Option B — the total is a third column
├──── labelWidth ────┤
┌──────────────┬───────────┬───────────────────────────────
│ ▾ AI         │ ‹ $6,240  │  $940   $1,120   $980   ...
└──────────────┴───────────┴───────────────────────────────
                            ↑ pushed right by the total column;
                              no longer under the canvas's Jul 20 ✗
```

**Decided: Option A.** Widen the label column and right-align the total inside it.
It still reads as a left-hand total column, and `labelWidth` stays the single
shared origin, so nothing drifts. Option B would additionally require a matching
spacer in `CanvasView` to keep the two calendars honest — a much larger change for
the same look.

### 6.2 What the totals total (CO11 resolved)

**Every period is totalled, whether or not it's on screen.** The left Total column
is each row's *entire* cost across the Pulse — all time, all periods — not a sum of
the visible cells. The bottom-right corner cell is the grand total on the same
basis.

This is the right default: the total is the number people quote and act on, and it
must not change because someone panned the canvas. A window-scoped total silently
under-reports a budget.

The consequence to design around: **the Total column will often not equal the
period cells beside it**, and that must never look like an arithmetic bug. So:

- Label the column so the scope is unambiguous — `TOTAL (all)`, not bare `TOTAL`.
- When a row has spend outside the visible window, mark it — a small `‹` / `›`
  affordance on the side the money sits, with a tooltip breaking it down
  (`$1,240 before · $3,100 in view · $472 after`). It doubles as a hint to scroll.
- The **bottom Total row's period cells stay per-period** (they're column sums of
  what's rendered) — only the left/corner totals are all-time. The header carries
  the plain-language version: *"$4,812 total · $3,100 in view."*

Filters *do* narrow the totals — a total should reflect what you asked to see. Only
the **time window** is ignored.

## 7. Permissions, audit, entitlements

- **Read** follows the parent feature's read scope: a My-Beat Viewer sees costs on
  tasks their linked account is on, and no others. Enforced via `scopeUids` on the
  cost doc (§5) — the same denormalization the activity log uses, for the same
  reason: rules can't join.
- **Write** follows the parent feature's **edit** scope. A Task Lead logging AI
  spend on a task they lead must work; that's the main data-entry path. Editors
  write anywhere, viewers nowhere.
- **Rate cards and type config** follow `editConfig` (they're Pulse-level
  settings), not `editScope`.
- **No `editCosts` capability** (**CO12**) — AI costs derive their gate from the
  feature they hang off. *Recommend confirming this rather than adding one: another
  flag means another preset column in every role, for a permission that has no
  coherent meaning apart from "can edit this task".*
- **People costs are the exception, and they do need a flag.** §8.7: pay rates are
  admin-only, so `people` cost is gated by `viewPeopleCost` (owner by default) and
  not by the parent feature's read scope. An editor who can see every task must
  still not see anyone's rate. This is the one place where "costs inherit the task's
  gates" does not hold, and it is enforced by the rate documents living in their own
  admin-only collection rather than by a client-side check (**CO15**).
- Rules sketch, following the `features` block:

```
match /costs/{costId} {
  allow read:   if isPulseMember(pulseId) && (
                  callerReadScope(pulseId) == 'all' ||
                  request.auth.uid in resource.data.scopeUids);
  allow create: if isPulseMember(pulseId)
                && request.resource.data.featureId is string   // CO5: never null
                && (callerEditScope(pulseId) == 'all' ||
                    (callerEditScope(pulseId) == 'lead'
                     && leadsFeature(pulseId, request.resource.data.featureId)));
  allow update, delete:
                if isPulseMember(pulseId) && (
                  callerEditScope(pulseId) == 'all' ||
                  (callerEditScope(pulseId) == 'lead' && leadsFeature(pulseId, resource.data.featureId)));
}
```

- **Activity log**: add `"cost"` to `ActivityEntityKind` with `create` / `edit` /
  `delete`, `entityName` = `"{model} · ${amount}"` name-at-time. Money changing on
  a task is exactly the kind of thing people need to reconstruct later. **Rate edits
  are the exception** — the log is member-readable, so a rate delta in it would
  defeat §8.7 (**CO18**).
- **Plans**: cost tracking is a plausible paid feature and a plausible quota
  (entries per Pulse). Not decided here — if gated, it lands as a flag in
  `Plans-Spec.md` §3.1 and composes as `entitlement ∧ capability`.

## 8. The `people` cost type — costing human effort

The second cost type, and the one that makes the §2 abstraction earn its keep: a
Pulse can now show what its *labour* costs alongside what its AI costs, in the same
view, on the same calendar.

### 8.1 Required behaviour

1. A cost type **`people`**, sitting beside `ai` in the registry.
2. Each Resource carries an **hourly cost**.
3. Assigning a resource to a task produces the corresponding people-cost row.
4. Changing an hourly cost, or changing an assignment, updates the corresponding
   cost.
5. Hours are **8 per weekday**; weekends count only when the task's weekend flag
   is on.
6. **People costs are visible to Pulse admins only.**

Everything below is how those six land without a sync surface and without leaking
anyone's rate.

### 8.2 The type

| Field | Value |
|---|---|
| `id` | `"people"` |
| `label` | `cost.type.people` |
| `measures` | **`hours`**, `priceScale: 1` (unit cost is quoted per hour, not per million) |
| `attributes` | `resourceId` (resourceRef, **required**, `inheritFrom: "hourlyRate"`) |
| `basis` | **always `"rate"`** — hours × $/h ⇒ amount (§3) |
| `groupBy` | `["resourceId", "featureId"]` — person › task |
| `color` | distinct from AI's violet |

This is precisely the `"rate"` half of §3 that had no user until now. Nothing in
the derivation, the proration (§5.2), the view (§6) or the totals changes shape to
accommodate it — which is the test the two-type design was meant to pass.

### 8.3 Where the hourly cost lives — *not* on the Resource

Requirement 2 says "add a field to resources"; requirement 6 says admins only.
**Those two are incompatible as written**, and this is the single most important
correction in this section.

Firestore security is **per document, never per field**. `pulses/{p}/resources/{id}`
is readable by every member (they need names, initials, avatars and capacity to
render the canvas). Put `hourlyCost` on that document and every member can read
every salary with one console call — the UI hiding it changes nothing.

So the rate lives in its own document:

```ts
/** pulses/{pulseId}/rates/{resourceId} — admin-readable only (§8.7). */
export interface ResourceRate {
  resourceId: string;
  hourlyCost: number;      // USD per hour (CO8: USD only)
  currency: "USD";
  updatedAt: Timestamp;
  updatedBy: string;
}
```

One document per resource, keyed by resource id, so it is addressable without a
query — the same reason `invites` are keyed by email (§ that doc's rationale).
`Resource` itself gains **no** cost field. The Capacity tab shows a rate input to
admins, writing through to `rates/{id}`; to everyone else that control doesn't
exist and the underlying document is unreadable.

### 8.4 Hours, and where they come from

Pulse already knows how long a task takes and how much of a person is on it. People
cost reuses that rather than inventing a parallel model:

```
hours(feature, resourceId)
  = elapsedOf(feature)                    // working days, weekend-aware
  × hoursPerDay                           // 8 (CO16)
  × allocOf(feature.alloc, resourceId)/100

amount = hours × rate.hourlyCost
```

- **`elapsedOf` already implements requirement 5.** It returns the span's working
  days and includes weekends exactly when `feature.useWeekends` is set
  (`domain/graphEffort.ts`). Weekend behaviour therefore needs no new logic and
  can't drift from the effort model.
- **Allocation is respected**: someone at 50% on a 5-weekday task is 20 hours, not
  40.
- **Task-level assignments only.** Subtask assignments are "who's responsible"
  markers and deliberately contribute no allocation (see `allocSum`); they
  contribute no cost either. Same rule, one place.
- **`Resource.capacity` is not used.** Capacity is an occupation *limit* for
  utilization warnings; it is not a billing basis. A person over 100% allocated
  costs more, and that is the correct signal.
- Restated in the model's own terms: **people cost = Assigned Effort (per resource,
  in man-days) × `hoursPerDay` × rate**.

For the view, derive **per day** rather than totalling and prorating: each eligible
day contributes `hoursPerDay × alloc% × rate`. Identical result, no rounding
remainder to distribute, and automatically consistent with §5.2's calendar.

### 8.5 Derived, not materialized (CO13 — resolved)

**Decided: people-cost rows are derived, never stored.** Requirements 3 and 4 —
rows appearing on assignment, following rate and allocation edits — are satisfied by
computing them from data that already exists: the assignment, the allocation, the
task's span and weekend flag, and the rate.

The reasoning, recorded because it will be questioned later:

- **A rate change is a fan-out write storm if materialized.** One senior developer's
  raise would rewrite every people-cost row for that person across every task in
  every Pulse — potentially thousands of documents, each one a write, each one an
  activity-log entry. Derived, it is a single-document edit and every figure moves.
- **Materialized rows carry no information the derivation doesn't.** Requirement 4
  says a rate change *updates* the record, so the stored row is always just the
  current rate re-applied. A copy that must always equal a computation is a cache,
  and this one has no read-path problem to solve — the client already holds
  features, resources and (for admins) rates in memory.
- **The repo has already paid for this lesson.** `reconcileDenorms` exists solely
  because a denormalized copy (`assignedUids`, `scopeUids`) drifts from its source.
  A materialized people cost would need the same loop, and it would need to fire on
  every box drag, every alloc slider move, and every rate edit.
- **Fewer secrets to guard.** Derived, the only admin-only data is `rates/*` — one
  collection, one rule. Materialized, the *amounts* are equally sensitive and need
  their own protected collection plus a query-shape constraint for non-admins
  (§8.7).

**What would have forced materialization** — freezing a rate against a closed period,
or invoicing — is explicitly out of scope (§0.1), so nothing does. If it ever returns,
the shape is a **snapshot on demand**: a "close the month" action writing immutable
rows, mirroring Pulse's existing `plannedX` / `estEffort` lock idiom rather than a
background reconciler. A materialized-and-synced variant would have to be a server
function per `Server-Functions-Spec.md` §4 — the client cannot be trusted to fan a
rate change across other people's tasks.

### 8.6 Lifecycle — what actually happens on each event

| Event | Derived (recommended) | Materialized (alternative) |
|---|---|---|
| Resource assigned to task | row appears | write 1 doc |
| Unassigned | row disappears | delete 1 doc |
| Allocation % changed | amount moves | update 1 doc |
| Task dragged / resized / weekend flag toggled | hours and amount move | update every row on that task |
| **Hourly cost changed** | one rate doc written; every figure moves | **update every row for that resource, everywhere** |
| Resource deleted | rows vanish with the assignment (existing cascade strips it from features) | cascade delete |
| Rate absent | **no row** (§8.8) | no doc |

### 8.7 Visibility — admins only, enforced in rules

Salary data is the most sensitive thing this spec touches. Three separate leaks have
to be closed, and only the first is UI work:

1. **The rate documents.** `pulses/{p}/rates/*` is admin-only, read *and* write:

```
function isPulseAdmin(pulseId) {
  let m = get(/databases/$(database)/documents/pulses/$(pulseId)/pulseMembers/$(request.auth.uid)).data;
  return m.role == 'owner'
      || (m.role == 'custom' && 'caps' in m && m.caps.get('viewPeopleCost', false));
}

match /rates/{resourceId} {
  allow read, write: if isPulseMember(pulseId) && isPulseAdmin(pulseId);
}
```

   Because the client cannot read rates, a non-admin's client **cannot compute**
   people cost at all. The feature fails closed by construction rather than by
   remembering to hide a component.

2. **The activity log.** `pulses/{p}/activity/*` is member-readable. An entry
   reading *"changed Ana's rate from $80 to $95"* leaks exactly what §8.3 protects,
   and `scopeUids` cannot express "admins only" — it holds uids, and the admin set
   changes. *Recommend logging the event without values* — `"updated a rate"`,
   entity = the resource, no `deltas` — or omitting rate edits from the log
   entirely (**CO18**).

3. **Totals.** An admin and an editor looking at the same Cost view see different
   grand totals, because one includes labour. That is correct, not a bug, but it
   must be legible: the header states the scope (`"$4,812 · AI only"` for
   non-admins), and the type row simply doesn't exist for them (**CO19**).

Writing a rate is `isPulseAdmin`, deliberately narrower than `editResources` — an
editor may rename people and change their capacity without being trusted with pay.

### 8.8 Missing rates, and the honest-zero problem

An assigned resource with no rate contributes **no row**, not a zero row. Zero is a
number people believe; absence prompts a question. To stop silent under-reporting,
the Cost view shows admins a hint when it applies — *"3 assigned people have no
hourly cost set"* — linking to the Capacity tab.

### 8.9 AI costs are actuals; people costs are a plan (CO17 — accepted)

An AI entry records money that was really spent. A people cost is derived from the
*schedule* — assignment × span × rate — so it is what the plan implies, not what
anyone's timesheet says. A total therefore adds AI actuals to labour plan.

**This is accepted, per §0.1.** It is the right answer to "roughly what will this
cost", which is the question the view exists to answer. Timesheets are not coming.

Two consequences to keep in mind rather than fix:

- A task months in the future already carries labour cost while its AI cost is zero.
  That's the plan showing through, not a bug.
- The figure moves when the *schedule* moves. Drag a box longer and labour cost
  rises, with no one having worked an extra hour.

Worth a single word in the UI so nobody over-reads it — the people row labelled
*planned*, or the header noting the total mixes the two. Not worth more than that.

### 8.10 Retroactivity — a raise rewrites history (CO20 — accepted)

One rate per resource, applied across all time. Give someone a raise in July and
June's reported labour cost changes with it.

**Accepted, per §0.1.** It also matches how the rest of the model already behaves:
change a box and its history changes, because Pulse stores the current plan rather
than a ledger of past states.

The upgrade path exists if the need ever appears — **effective-dated rates** at
`rates/{resourceId}/history/{fromDay}`, with the derivation picking the rate in force
on each day it prices. The per-day derivation in §8.4 is already the right shape, so
this stays cheap to add later and costs nothing to leave out now.

The point of §2's shape is that this arrives as **a registry entry plus a
derivation source**, with the view, proration, totals, permissions and audit
already in place.

## 9. Implementation notes

- **`src/domain/costs.ts`** — pure functions, no React/Firestore, unit-tested like
  `graphEffort.ts` / `assignments.ts`: `amountOf(entry, type)`,
  `unitCostOf(entry, type, measureId)`, `spanOf(entry, feature)`,
  `costInRange(entries, features, filter, dStart, dEnd)`. The view does no math.
- **People costs (§8) — `peopleCostRows(features, rates, hoursPerDay)`** in the same
  module: derives synthetic `CostEntry` values from assignments so the whole
  downstream pipeline (`bucketEntries`, `buildCostTree`, the $/hours toggle, the
  totals) works on them unchanged. Returns nothing when `rates` is empty, which is
  exactly what a non-admin's client holds.
- **`CostPanel`'s dimension pivot is currently AI-shaped.** `groupByFor` forces the
  global `DIMENSIONS` order (`model`, `resourceId`, `featureId`) onto *every* type, so
  a `people` row would grow a spurious "unattributed model" level. It must intersect
  the requested order with what the type actually declares — a small change, but it
  breaks visibly if missed.
- **The $/tokens toggle needs a third state or a rename.** `tokens` is meaningless
  for `people` and `hours` is meaningless for `ai`. Cleanest is `$` vs *"quantity"*,
  where each type's row shows its own measure's unit (`fmtQuantity` already takes the
  raw number; only the label is type-specific).
- **`src/services/firestore/costs.ts`** — `subscribeCosts` / `createCost` /
  `updateCost` / `deleteCost`, mirroring `resources.ts`. Wire into `pulseStore`
  alongside features and resources.
- **`firestore.indexes.json`** — a `costs` index on `featureId` if per-task queries
  are used; the v1 client subscribes the whole collection per Pulse (as it does for
  features) and filters in memory. Revisit if an entry count gets large enough to
  matter — that's when a rollup function belongs in `Server-Functions-Spec.md`.
- **i18n** — every new string goes into **all six** dictionaries (`en`, `es`, `pt`,
  `fr`, `it`, `de`). `Dict` is exact: a key missing from one locale is a compile
  error, not a runtime fallback.
- **Undo** — cost create/edit/delete should record through `undoStore` like other
  mutations, so a mistyped $40,000 is one ⌘Z away.
- **Deletion** — deleting a feature must **cascade** to its costs. Orphaning isn't
  an option now that `featureId` is required (CO5), and an orphan would have no
  span to prorate anyway. Record it as one undo op so restoring the task restores
  its spend.

## 10. Decisions (CO1–CO20)

### 10.1 Resolved

2. **CO2 — AI measures. ✅ RESOLVED: one `tokens` measure.** No input/output split.
   Viable because AI entries are amount-based (CO4), so the mix never has to
   reconstruct the money. Accepted consequence: the derived unit cost is a
   **blended** $/Mtok, and two entries on the same model may show different unit
   costs. Splitting later is additive (§2.1).
4. **CO4 — Ship vendor prices? ✅ RESOLVED: no price table at all.** Unit cost is
   always calculated from actuals — enter tokens and dollars, $/Mtok falls out.
   No catalog, no per-Pulse overrides, no as-of-when question. Accepted
   consequence: **AI cost can't be forecast from a token estimate** until there's
   history to blend a rate from (§4).
5. **CO5 — Pulse-level costs. ✅ RESOLVED: no.** `featureId` is required; every
   cost hangs off a task. That's also what guarantees each entry has a span to
   prorate over and a permission scope to inherit, so nothing can fall outside the
   period columns (§5.1).
7. **CO7 — Third grouping level. ✅ RESOLVED: yes, add the person.** The view nests
   type › model › person from `groupBy: ["model", "resourceId"]`. Unattributed
   entries collect under an "unattributed" child (§6).
8. **CO8 — Currency. ✅ RESOLVED: USD only.** `currency: "USD"` stays on the entry
   as a literal so a future multi-currency change is additive rather than a
   migration.
11. **CO11 — Total scope. ✅ RESOLVED: all periods, regardless of visibility.** The
    left Total column and the corner cell are all-time; panning must not change
    them. The bottom row's period cells stay per-period. Because the total will
    often exceed the visible cells, the column is labelled `TOTAL (all)` and rows
    with off-screen spend carry a `‹`/`›` marker with a breakdown tooltip — the
    mismatch has to read as *scope*, never as a bug (§6.2).

9. **CO9 — Estimated vs actual cost. ✅ RESOLVED: actuals only in this phase.**
   Budget-vs-actual — an expected figure per task, compared against what was
   really spent — is the natural partner to Estimate Effort, and is deferred, not
   rejected.

   Note the interaction with CO4: with no price table, a *token* estimate can't be
   priced. When estimates land, they'll be entered in **dollars**, or priced from
   a rate blended out of that Pulse's own history.

   Adding them later costs one optional field on `CostEntry`:

   ```ts
   kind?: "actual" | "estimate";   // absent = "actual"
   ```

   An `"estimate"` entry is a budget line ("we expect ~$500 of Opus here"); an
   `"actual"` is recorded spend. Same collection, same fields, same proration and
   view — the view just sums the two separately and shows one against the other.

   **No migration needed** when that day comes: normally a new field means
   backfilling every existing document, but here the absent case has an obvious
   meaning (everything recorded so far is an actual), so code reads
   `entry.kind ?? "actual"` and old documents stay correct untouched. The codebase
   already does exactly this with `Comment.targetKind` (*"Absent/`task` = a task,
   back-compat with pre-resource-comment data"*) and with `PulseRole`'s legacy
   `"viewer"`, resolved by `canonicalRole` instead of rewriting member docs.
10. **CO10 — Total column placement. ✅ RESOLVED: inside the label column.** The
    column widens and right-aligns the figure, so `labelWidth` stays the single
    shared origin and the panel's calendar keeps lining up with the canvas's. A
    real third column would push the time axis right and require a matching
    spacer in `CanvasView` (§6.1).

### 10.2 People costing (§8)

**Resolved**

13. **CO13 — Derived or materialized? ✅ RESOLVED: derived, never stored (§8.5).** A
    rate change is one write instead of a fan-out across every task the person is on,
    and there is no copy to drift. Materialization would only have been needed for
    frozen periods or invoicing, both out of scope.
17. **CO17 — Mixing actuals and plan. ✅ RESOLVED: accepted (§8.9).** AI figures are
    actuals, labour is derived from the schedule; a total adds the two. No timesheets.
    Worth one word of labelling in the UI, nothing more.
20. **CO20 — Retroactive rates. ✅ RESOLVED: accepted (§8.10).** One current rate per
    person, applied across all time; a raise moves historical figures. Effective-dated
    rates remain a cheap later addition and are not being built.

**Open**

14. **CO14 — Rate storage.** `pulses/{p}/rates/{resourceId}`, *not* a field on
    `Resource`. Not really optional: Firestore has no field-level security, so a rate
    on the member-readable resource doc is public to every member (§8.3). The only
    alternative is accepting that all members can see all rates.
15. **CO15 — Who is an "admin"?** *Recommend `owner`, plus `custom` roles carrying a
    new `viewPeopleCost` capability.* Alternatives: reuse `manageMembers` (fewer
    flags, but conflates "can add people" with "can see their pay"), or Pulse-owner
    only (simplest, no new capability).
16. **CO16 — Is 8 hours/day configurable?** *Recommend a Pulse-level `hoursPerDay`
    defaulting to 8*, since 7.5 and 6-productive-hours are both common. One number,
    same home as `graphConfig`.
18. **CO18 — Logging rate changes.** *Recommend logging the event without values*
    (`"updated a rate"`, no `deltas`) — the activity log is member-readable and
    `scopeUids` can't express "admins" (§8.7).
19. **CO19 — Non-admin totals.** A non-admin's Cost view excludes labour, so their
    grand total differs from an admin's. *Recommend labelling the scope in the header
    ("AI only") rather than hiding the discrepancy.*

### 10.3 Still open — implementation-level

None of these blocks starting the build; each can be settled by whoever picks it up.

1. **CO1 — Type registry location.** Code registry vs. user-defined types on the
   Pulse doc. *Recommend: code now; `Pulse.costTypes` later if needed.*
3. **CO3 — Multiple measures on one type.** Moot in practice (AI has one measure,
   the human type will have one), but the shape allows it. How a single amount
   would split across several measures is deferred until a type needs it.
6. **CO6 — Cache the derived amount.** Store `amountMicros` even under
   `basis: "rate"` (fast sums, must be recomputed on edit) or derive every read?
   *Recommend: store it, single writer in the service layer.* Doesn't bite until
   the human type lands, since AI amounts are entered, not derived.
12. **CO12 — Capability flag.** Inherit the feature's gate vs. a new `editCosts`
    capability in `Capabilities`. *Recommend inherit — a separate flag adds a
    column to every role preset for a permission with no meaning apart from "can
    edit this task" (§7).*

> **Cross-refs (in place):** `Pulse-Product-Spec.md` §3 defines Cost as a core entity
> alongside Feature/Resource, and §6 lists the Cost view; `Permissions-Spec.md` §4.5
> records that costs inherit the parent feature's read/write gates rather than adding
> an `editCosts` capability; `Changelog-Spec.md` §2.1 carries the `cost` entity kind;
> `Plans-Spec.md` §3.1 lists cost tracking as a **gating candidate only** — whether
> it's gated at all is open (PL2/PL3), with the caveat that recorded spend is history
> and a downgrade must never drop entries.
