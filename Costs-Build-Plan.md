# Pulse — Costs Build Plan

Companion to **`Costs-Spec.md`** (what to build and why). This is **how**, in order,
against the codebase as it stands at `5a36519`.

Six phases. Phases 0–2 ship no UI and can land behind nothing — there's no feature
flag to manage because an empty `costs` collection renders as nothing. Phases 3 and
4 are independent once 2 lands and can run in parallel.

Sizes are rough calibration, not commitments: **S** ≈ half a day, **M** ≈ 1–2 days,
**L** ≈ 3–4 days.

---

## Phase 0 — Types and domain math (S–M)

Pure logic first, in the codebase's existing shape: `src/domain/*.ts` files are
React-free and Firestore-free, and unit-tested (`graphEffort.test.ts`,
`assignments.test.ts`). Everything numeric lands here so the view later does no math.

**New files**

- `src/domain/costTypes.ts` — the registry (CO1: code, not user data). Exports
  `AI_COST_TYPE` and `costTypeById(id)`. One entry: `tokens` measure at
  `priceScale: 1_000_000`; attributes `brand` (enum), `model` (text),
  `resourceId` (resourceRef); `basis: "amount"`; `groupBy: ["model","resourceId"]`.
- `src/domain/costs.ts` —
  - `amountOf(entry, type)` → micro-dollars
  - `unitCostOf(entry, type, measureId)` → number **|null** (null when quantity is 0 — mirrors `theoreticalElapsed`)
  - `spanOf(entry, feature)` → `{start, end}` via the §5.1 resolution order
  - `prorateToDays(entry, feature)` → `Map<day, micros>`, weekend-aware through `businessInSpan`
  - `costInRange(entries, featuresById, dStart, dEnd)` and `costTotal(entries)`
  - `buildCostRows(entries, types, resources, periods)` → the type › model › person tree the view renders
- `src/domain/costs.test.ts`

**Edit** `src/types/index.ts` — `CostTypeId`, `CostBasis`, `CostMeasureDef`,
`CostAttributeDef`, `CostTypeDef`, `CostEntry` (spec §2/§5), and
`ActivityEntityKind |= "cost"`.

**Tests that must exist** (these are the ones that will actually break later):
weekend exclusion and the `useWeekends` override; a span with zero working days
falling back to calendar days; point cost (`at`) landing in exactly one period;
partial overlap at the window edge; unit cost null at quantity 0; micro-dollar
accumulation — prorate a total across 23 days, re-sum, assert it equals the
original exactly.

**Exit:** `npx tsc -b`, `npm run lint`, `npm test` green. Nothing user-visible.

---

## Phase 1 — Persistence and security rules (M)

**New** `src/services/firestore/costs.ts` — `newCostId` / `subscribeCosts` /
`createCost` / `updateCost` / `deleteCost`, a direct mirror of `resources.ts`
(same `stripUndefined` patch discipline).

**Edit** `firestore.rules` — the `costs` block from spec §7, inside
`match /pulses/{pulseId}`: read gated by `callerReadScope`/`scopeUids`, write by
`callerEditScope` with the Task Lead carve-out, and `featureId is string` enforced
on create (CO5).

**Edit** `rules/security.test.ts` — add a `describe("costs")` alongside the existing
role blocks: non-member denied; My-Beat viewer reads only costs whose `scopeUids`
contain them; Task Lead writes on a task they lead and is denied on one they don't;
editor writes anywhere; create with a null `featureId` rejected.

**Exit:** `npm run test:rules` green (needs the emulator — `npm run emulators`).

> ⚠️ **Deploy debt to clear first.** `firestore.rules` and `firestore.indexes.json`
> have carried uncommitted-then-committed changes since `27d381f` that have **never
> been deployed** — every deploy so far has been `--only hosting`. Costs will fail
> in production the moment the client writes, because the live rules have no `costs`
> block. Plan a `firebase deploy --only firestore` with this phase, and check what
> else that first rules deploy carries.

---

## Phase 2 — Store, undo, activity (M)

**Edit** `src/stores/pulseStore.ts`

- `costs: CostEntry[]` in state; `subscribeCosts` added to `load()`'s `unsubs` array.
- `addCost` / `patchCost` / `removeCost`, following `addResource`/`patchResource`/
  `removeResource` exactly: mutate, then `recordSingle("Add cost", pulseId, createOp("cost", …))`.
- **Cascade** — `removeFeature` must delete that feature's costs in the same
  `recordMany`, the way `removeResource` already fans out across features (spec §9).

**Edit** `src/stores/undoStore.ts` — `DocKind |= "cost"` and a `case "cost"` in
`write()`. The switch is exhaustive, so TypeScript will point at every site.

**Edit** `src/domain/activityRecorder.ts` — `KIND_TO_ENTITY.cost = "cost"`, plus
`entityNameOf` (`"claude-opus-5 · $412"`), `verbOf`, and `scopeUidsFor` for the new
kind.

> **Watch item — `scopeUids` staleness.** A cost copies its parent feature's
> `assignedUids` at write time. Reassigning the task later changes the feature's
> denorm but *not* its costs', so a newly-added beat viewer silently can't read
> existing costs on their own task. The store already runs a `reconcileDenorms(get)`
> loop on every features/resources/members snapshot — **extend it to costs**, and
> keep the reconcile writes `{record: false}` so they don't pollute undo or the
> activity log (see `MutateOpts`). Don't defer this; it presents as a permissions
> bug months later.

**Exit:** a cost can be created, edited and deleted from the store; ⌘Z restores it;
an entry appears in the Activity tab.

---

## Phase 3 — Data entry in the task editor (M)

**Edit** `src/components/leftPanel/DetailsTab.tsx` — a **Costs** section under the
effort panel: the task's entries listed with model, tokens, amount and derived
$/Mtok; add / edit / delete inline. The form renders from the type's
`attributes[]` — enum → select, text → input with a `datalist` of models already
used in this Pulse, resourceRef → the existing resource picker with `ResourceBadge`.
Gate on `canEdit` (the prop DetailsTab already receives, which is per-feature).

Money input takes dollars and converts to micros at the boundary; display via
`Intl.NumberFormat` with the locale from `i18nStore`.

**i18n** — every new string into **all six** dictionaries. `Dict` is exact: a key
missing from one locale is a compile error, not a runtime fallback.

**Exit:** AI spend can be recorded on a task end to end, and survives reload.

---

## Phase 4 — The Cost view (L)

**New** `src/components/costPanel/CostPanel.tsx`. It takes the same props
`AssignmentPanel` does (`offsetX`, `dayWidth`, `viewZoom`, `density`, `startDay`,
`endDay`, `weekends`, `labelWidth`, `selectedFeature`) and reuses `buildPeriods`,
the mini ruler markup, `MultiSelectFilter` and the `scaleX(viewZoom)` /
`scaleX(1/viewZoom)` counter-scaling trick for cell labels.

**Edit** `src/routes/PulsePage.tsx` — a `bottomPanel: "assign" | "cost"` state and a
segmented control in the panel header; render one or the other in the existing
`assignPanelOpen` block (`PulsePage.tsx:501`). No new layout, no new resize handle.

Build order inside the phase: rows and period cells → totals (left, all-time) →
sticky footer → expand/collapse → off-window `‹`/`›` markers → filters → empty
states.

> **Build question BQ1 — the collapsed sidebar.** The panel is passed
> `labelWidth={sidebarOpen ? 320 : 30}`. CO10 puts the total *inside* the label
> column, which works at 320px and is impossible at 30px. Options: hide the total
> column when the sidebar is collapsed (totals move into the row tooltip), or clamp
> the width and accept losing canvas alignment in that state. *Recommend hiding it —
> CO10 chose alignment over the column, and that choice should hold in both states.*

**Exit:** the view matches the §6 mock, and totals still read correctly while
panning, zooming and switching density.

---

## Phase 5 — Edges and rollout (S–M)

- **Mobile** — there is no bottom panel in `MobilePulseView` (tabs are Tasks / Team /
  Capacity / Activity). Decide: read-only costs inside the mobile task editor, a
  fifth tab, or explicitly out of scope for v1. *Recommend: entries visible and
  editable in the task editor (Phase 3 gives this nearly free, since `DetailsTab` is
  what mobile renders), no Cost view on mobile.*
- **Number legibility** — `$1.2M` style abbreviation in narrow period cells, full
  value in the tooltip; the panel already drops labels that can't fit
  (`showNum` in `AssignmentPanel.tsx`).
- **Scale check** — the v1 client subscribes every cost in the Pulse, like features.
  Fine for hundreds. If a Pulse reaches thousands, that's the trigger for a rollup
  function and an entry in `Server-Functions-Spec.md`, not a client fix.
- **Deploy** — hosting *and* `--only firestore` (see the Phase 1 warning).

---

## Dependency order

```
Phase 0 ─→ Phase 1 ─→ Phase 2 ─┬─→ Phase 3 ─┬─→ Phase 5
  types      rules     store    │   entry    │
  math       service   undo     └─→ Phase 4 ─┘
                       activity      view
```

Phase 2 is the real gate: everything visible depends on the store, undo and
activity being wired. Phases 3 and 4 are parallelizable across two people, and
Phase 4 can be developed against hand-seeded documents if 3 isn't finished.

## Decisions this plan resolves as it goes

The four open items in `Costs-Spec.md` §10.2 land naturally in-phase, none of them
blocking:

| Decision | Resolved in |
|---|---|
| **CO1** — registry in code | Phase 0, by building it that way |
| **CO3** — multi-measure split | Not exercised; AI has one measure |
| **CO6** — cache the derived amount | Phase 0/2 — moot while every AI entry is amount-based |
| **CO12** — no `editCosts` capability | Phase 1, by writing the rules with inherited gates |

## Risk register

| Risk | Mitigation |
|---|---|
| Live rules have no `costs` block and are already behind | Deploy `--only firestore` in Phase 1; audit what else that first deploy carries |
| `scopeUids` going stale on reassignment | Extend `reconcileDenorms` in Phase 2 — not later |
| Float drift in prorated money | Micro-dollar integers throughout; the round-trip test in Phase 0 |
| Total column vs. collapsed sidebar | BQ1, decided before Phase 4 starts |
| Cost view diverging from the assignment panel's geometry | Reuse `buildPeriods` and the ruler markup rather than re-deriving |
