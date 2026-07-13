# Pulse — Product Spec

**by Yasdu** · Visual project planning on an infinite canvas

## 1. What Pulse is

Pulse is a graph-first project management tool. Instead of a conventional Gantt chart, features and tasks live as draggable boxes on an infinite 2D canvas: the x-axis is time (start date and duration), and the y-axis is grouped into "epics" — user-defined swimlanes. A box's height is not decorative — it encodes **work intensity** (parallel effort per day), so effort is a visual, graphable property alongside schedule, not a separate spreadsheet.

A working HTML/React prototype exists (`Pulse-Prototype.html` in this delivery) and is the source of truth for interaction design and the effort model. This spec describes what it does so a real, persisted, multi-user version can be built from it.

## 2. Goals

- Let a PM lay out a roadmap visually: drag features across time, drag to resize duration, drag to resize effort (height), group into epics.
- Make staffing health visible at a glance: is a task under-, over-, or right-staffed relative to its estimate.
- Track plan vs. actual: freeze a baseline (planned dates) and see delay/recovery deltas over time.
- Give a resource-centric view: per-person timeline of assignments, utilization against a configurable capacity limit, and per-period (day/week/month) allocation load.
- Stay fast and fluid — canvas panning/zooming, inline editing, drag-and-drop assignment — with no page reloads or modal-heavy workflows.

## 3. Core entities

**Pulse** — one roadmap instance (the prototype's code calls this a "board"; the product-facing name for it is a **Pulse**, not to be confused with the app name). Has a name (e.g. "Pulse de conciliaciones"), used as the browser tab title (`{boardName} — Pulse`). A user has access to several Pulses — see §8.

**Epic** — a swimlane: `id, name, color, y0, y1` (vertical extent), plus optional manual overrides (`manualY0/Y1/MinX/MaxX`) that extend but never clip the auto-fit extent computed from its features. Resizable via edge/corner drag handles on the canvas.

**Feature (box)** — the core planning unit:
- `x` (start day, integer offset from an epoch), `y` (vertical position)
- `duration` (calendar-day span; the box's on-canvas width)
- `work` (or legacy `effort`) — drives box height via the Graph Effort scale (see §4)
- `status`: planned / in-progress / blocked / done, each with its own border/bg/text color
- `resources`: array of assigned resource IDs, plus `alloc: {resourceId: pct}` for % time per person (default 100%)
- `lead`: resource ID marked as team leader (★), rendered with a square badge
- `epicId`: which swimlane it belongs to (auto-detected on vertical drag-drop by overlap with epic bands)
- `labelColor`: optional color dot/stripe to visually group unrelated tasks across epics
- `ai`: boolean, "AI-assisted estimate" flag (✨ badge)
- `useWeekends`: boolean — if false (default), weekends are excluded from working-day math
- `estEffort`: manual override for Estimate Effort; when unset, Estimate Effort = Graph Effort
- `plannedX` / `plannedDuration`: frozen baseline snapshot, set via "📌 set plan"
- `attachments`: array of `{id, title, url, isData}` — pasted links or uploaded files (stored as data URLs in the prototype)
- `children`: optional subtasks (see below); when present the box can expand inline to list them
- `collapsed`: whether an expandable box is showing its subtask list

**Subtask (child)** — lightweight nested task: `id, title, status, resources, effort, alloc, attachments`. No independent schedule — it inherits the parent's time span.

**Resource** — a team member: `id` (2-3 letter initials, auto-generated and de-duplicated), `name`, `capacity` (occupation limit %, default 100), `type` (freeform category like Dev, QA, Consulting, Devops, Producto — user-manageable list, addable/renameable/deletable).

## 4. The Graph Effort model

This is Pulse's key differentiator vs. a plain Gantt chart: box **height** is a first-class, editable unit of work, not styling.

- Global scale: `stepPx` (pixels per step, default 16) and `workPerStep` (work units per step, default 1) — user-adjustable via an "Effort scale" settings popover.
- `workOf(box)` = work units implied by the box's height, snapped to whole steps.
- `boxHeight(box)` = `18 + steps × stepPx` (plus subtask rows if expanded).
- **Elapsed Time** = the box's length in working days (weekends excluded unless `useWeekends`).
- **Graph Effort** = Elapsed Time × work-per-day (i.e., what the box's shape literally encodes). Unit: man-days.
- **Estimate Effort** = manual value if the user has "locked" it (🔒), otherwise always equals Graph Effort. Editable inline; a ↺ button resets it back to tracking Graph Effort.
- **Assigned Effort** = Elapsed Time × Σ(assigned resources' % allocation).
- **Theoretical Elapsed** = Estimate Effort ÷ Σ(assigned %) — "if this crew works on it, how long should it actually take."
- **Staffing dot** (shown on every box): compares Assigned vs. Estimate Effort with a 5% tolerance — red = under-staffed, green = right-staffed, yellow = over-staffed.
- "⇥ adjust length to resources" button: resizes the box's calendar span so the currently assigned team delivers the Estimate Effort exactly.
- Dragging a box's bottom edge changes `work` in discrete steps (visually "graphing" more or less parallel effort); dragging left/right edges changes `duration`/start; dragging the body moves it in time and can re-assign its epic.

## 5. Canvas & navigation

- Infinite pan: drag empty canvas background to scrub through time (horizontal) and scroll rows (vertical). Long-press arms an explicit "panning" indicator.
- Two independent zoom controls: **view zoom** (scales the whole canvas image, ctrl/cmd+scroll or +/− buttons, 20–200%) and **day width / scale** (stretches/compresses the time axis itself, 40–250%).
- Density modes — **day / week / month** — each with different primary bands (months/quarters/years) and secondary gridlines (days/weeks/months), plus a `fit` button that zooms/pans to show the entire roadmap.
- Weekend shading in day view; a persistent "today" marker line.
- Feature search/filter bar (text + status) that dims non-matching boxes rather than hiding them.
- "Compact" — repacks all epics and their features into the minimum vertical space using a lane-packing algorithm (features that don't overlap in time share a row).
- "Shrink epics" — toggles a title-only compact rendering of every box, useful for a bird's-eye view; restores the prior layout on toggle-off.
- "Delays" toggle — draws each box's frozen planned span as a dashed bar beneath it, with dotted connectors and delta labels (`start +Nd`, `end +Nd`) to the actual span, plus a "▲ Nd recovered" badge when a late start is clawed back by delivery.

## 6. Resource & assignment views

- **Team tab** (left panel): searchable roster, drag-a-chip-onto-a-box to assign (defaults to 100% allocation), click a person to filter the whole canvas + assignment panel down to just their work, per-person utilization bar (peak daily load ÷ capacity limit).
- **Capacity tab**: per-resource capacity slider/input (occupation limit %), resource-type management (add/rename/delete categories), peak/limit/used stats per person.
- **Details tab**: full editor for the selected box — title, epic, team leader, subtasks (inline add/edit/delete/reassign/attach), resource list with per-person % allocation slider, the effort panel from §4, status, label color, AI flag, attachments, delete.
- **Assignment-by-resource panel** (bottom, full width, resizable via drag handle, time-aligned with the main canvas ruler): one row per person showing their assignment bars (stacked into lanes when overlapping) plus a per-period (day/week/month) allocation-% strip color-coded green/amber/red. Filters: by resource, by status, under-allocated (<70%) / over-allocated (>100%) toggle, hide-idle toggle, and a compact mode that collapses each row to just a % bar.

## 7. Branding

- Wordmark "Pulse" with a small Yasdu logo mark and an uppercase "by Yasdu" tag in the toolbar.
- Yasdu color tokens: background `#FDFCF8`, ink `#1F2330`, primary orange `#D85A28`/`#EE7240`, navy `#123359`/`#0A1428`, plus per-status colors (planned/in-progress/blocked/done).
- Typography: Inter (body), Space Grotesk (display/headings), JetBrains Mono (numeric/technical labels).
- Every board can be given its own name, shown next to the Pulse wordmark and reflected in the document title.

## 8. Accounts, multi-tenancy & sharing

The real app is multi-tenant and multi-user, modeled on the same shape Trello uses for workspaces and boards:

- **Every signed-in user lands on a home/dashboard listing every Pulse they have access to** — the ones they created plus any they've been invited to collaborate on. This is the top-level "several pulses" view the user always starts from.
- **Workspace** — the tenancy boundary. Each user gets a personal workspace automatically on signup (so they can start working alone immediately), and can additionally belong to any number of shared/team workspaces. A workspace has members with roles (owner / member, at minimum) and owns a set of Pulses.
- **Pulse membership & invites** — a Pulse belongs to exactly one workspace. Within that, an owner or editor can invite a collaborator by email to a specific Pulse (not necessarily the whole workspace) — mirrors Trello's ability to add someone to one board without making them a full workspace member. Invited users who don't have an account yet go through sign-up first, then land directly on the Pulse they were invited to.
- **Roles per Pulse** (suggested, refine with the team before building): **Owner** (full control, can delete the Pulse, manage members), **Editor** (can edit everything §3–§6 covers), **Viewer** (read-only — useful for stakeholders who just want to watch progress). Enforce this both in the UI (hide/disable controls) and at the data layer (security rules / server-side checks) — never rely on the client alone.
- **Data isolation** — every query and every write must be scoped to a workspace/Pulse the requesting user is actually a member of. This is a hard multi-tenant requirement, not a nice-to-have: one tenant must never be able to read or write another's data, even via a crafted request.
- **Resources vs. real accounts** — today a "Resource" (§3) is just a freeform name/initials with no login. Decide during implementation whether every Resource must map 1:1 to a real invited user (cleanest for permissions and notifications) or whether "placeholder" resources without accounts should still be allowed for lightweight capacity planning (matches the prototype's current freedom to add a resource by typing a name). Recommendation: allow both, but visually distinguish resources that are linked to a real account from ones that aren't.

### Authentication

- Use **Firebase Authentication** for identity:
  - **Google sign-in** (OAuth) as the primary, frictionless path.
  - **Email + password** as the fallback for users who don't want to use Google.
- Firebase issues the session/identity token; the app's backend verifies it and resolves it to an internal user record (workspace memberships, role per Pulse, etc.) — Firebase itself doesn't need to know about workspaces or Pulses, it's purely the identity provider.
- Invite-by-email should tie into this cleanly: an invited email gets a pending-invite record; when that email signs in via Google or registers with matching email/password, the invite auto-resolves into workspace/Pulse membership.
- Firebase's own project (Firestore + Firebase Auth, optionally Cloud Functions) is a reasonable default datastore choice given the auth choice, but that's an implementation decision for §9/build time, not a hard requirement of this spec — Postgres-with-Firebase-Auth-only is equally valid if the team prefers a relational store for the roadmap data.

## 9. What the prototype does NOT yet do (gap for the real build)

- **No persistence.** All state (`INITIAL_BOXES`, `INITIAL_RESOURCES`, `INITIAL_EPICS`) is hardcoded in the file and resets on reload. There is no save, no backend, no database.
- **No auth / multi-user / multi-tenancy.** Single implicit user, no accounts, no workspaces, no permissions, no concurrent-editing story. §8 specifies what needs to replace this.
- **No API.** It's a static, single-file HTML page (React + Babel + Tailwind all loaded from CDN, JSX transpiled in-browser) — fine for a prototype, not for production.
- **Sample data is domain-specific.** The seeded resources/epics/features describe a real internal roadmap (a Nubceo-style delivery team and epics like "Conciliaciones", "Drakaris") — this needs to become empty/onboarding state or a proper seed/demo mode, not shipped as the default.
- **File attachments are base64 data URLs** held in memory — not viable for real file storage at scale.

## 10. Suggested scope for v1 of the real app

1. Firebase Authentication wired up: Google sign-in + email/password, with a personal workspace auto-created per new user.
2. Multi-tenant data model: Workspace → Pulse (§8) with membership, roles, and per-Pulse email invites; data access scoped and enforced server-side, not just hidden in the UI.
3. Multi-Pulse support with real persistence (each Pulse = one roadmap), backed by a real datastore, replacing the prototype's in-memory `INITIAL_*` state.
4. Everything in §3–§6 reproduced faithfully — this is the differentiated UX, don't simplify it away.
5. Real file storage for attachments (object storage + signed URLs) instead of inline data URLs.
6. Autosave / optimistic updates so nothing is lost on refresh; ideally realtime sync if multiple collaborators edit the same Pulse at once.
