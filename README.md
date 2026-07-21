# Pulse — by Yasdu

Visual, graph-first project planning on an infinite canvas. See
`Pulse-Product-Spec.md` for the product spec and `Pulse-Prototype.html` for
the original interaction-design prototype (kept as a reference only — this
directory is the real, persisted, multi-tenant app built from it).

## Stack

Vite + React 19 + TypeScript, Tailwind CSS v4, Firebase (Auth + Firestore),
Zustand, React Router, Vitest.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in your Firebase project's
   web app config (Firebase console → Project settings → General → Your
   apps → SDK setup and configuration).
3. Deploy security rules to your project: `npx firebase login`, then
   `npx firebase deploy --only firestore:rules,firestore:indexes --project <your-project-id>`
   (or update `.firebaserc`'s `default` project first).
4. `npm run dev`

### Developing against local emulators instead of a live project

Set `VITE_USE_FIREBASE_EMULATORS=true` in `.env.local`, then in one terminal:

```
npm run emulators   # Auth + Firestore emulators, http://127.0.0.1:4000 for the UI
```

and in another:

```
npm run dev
```

No real Firebase project is needed for this — `firebase.json`/`.firebaserc`
just need *a* project id string (emulators don't touch anything real).

## Scripts

- `npm run dev` / `npm run build` / `npm run preview`
- `npm test` — Graph Effort + layout domain math (Vitest)
- `npm run test:rules` — Firestore security-rules tests against the local
  emulator (spins the emulator up and down automatically)
- `npm run lint` — oxlint

## Notes

- **Data model & multi-tenant isolation**: see the comment block at the top
  of `firestore.rules`. Every read/write under `pulses/{pulseId}/**`
  requires a `pulseMembers/{uid}` doc; "list everything I have access to"
  (dashboard, invite discovery) deliberately avoids collection-group
  queries — see that same comment for why — in favor of denormalized
  per-user indexes (`users/{uid}/myPulses`, `inviteIndex/{email}/pending`).
- **Graph Effort math**: `src/domain/graphEffort.ts`, pure functions, unit
  tested in `src/domain/graphEffort.test.ts`.
- Attachments are stored the same way the prototype does (pasted links, or
  small files inlined as data URLs) — no object storage integration yet.
