# Pulse — Stripe Go-Live Runbook

Status: **Live as of 2026-08-14 — §2–§5 done; §6 (verify with a real card) is the
only remaining step, and it is also the first time the webhook will ever have run
end to end. §0's two decisions are still open.** · Owner: product + eng ·
Related: `Plans-Spec.md` (tiers, PL1–PL12), `Billing-and-Backend-Build-Plan.md`
(Phase 3 — what is built and what isn't), `Server-Functions-Spec.md` (SF3)

## 0. Read this first — two things that are not cutover steps

Both are product decisions, not tasks. Neither blocks the mechanics below, and
both are true the moment you take a real payment.

1. **Quotas are not enforced server-side.** The rules half of Phase 3 (SF11
   counters + the licensing gates) is unbuilt. `firestore.rules:176` has the
   `billing/{orgId}` read rule and `write: if false`, and **no quota gates** — its
   own comment says enforcement lands later. Today an org can exceed every limit
   its tier defines: the UI shows the right numbers and nothing server-side stops
   anyone. Charging $6/$12 per seat for limits that aren't enforced is a decision
   to make deliberately (**GL1**).
2. **No invoicing (CFDI).** Deferred at PL10-a. You will be billing as a Mexican
   entity to Mexican customers, who routinely require a CFDI. Confirm with whoever
   handles the company's tax obligations *before* the first live charge, not after
   (**GL2**).

## 1. What "migrate to production" actually means here

`.firebaserc` declares **one** project, `pulse-b9d96`. There is no separate dev
Firebase project — so "dev" here means **Stripe test mode**, and its residue is
sitting in the *same* Firestore that serves real users. That is what makes §4
(data cleanup) mandatory rather than housekeeping.

Verified live state at the time of writing:

| Thing | State |
| --- | --- |
| Functions deployed | all 10, including `stripeWebhook` |
| `STRIPE_SECRET_KEY` | version 1, ENABLED (never rotated) |
| `STRIPE_WEBHOOK_SECRET` | version 1, ENABLED (never rotated) |
| Webhook URL | `https://us-central1-pulse-b9d96.cloudfunctions.net/stripeWebhook` |
| `pulse.yasdu.com` | resolves (CNAME → `pulse-b9d96.web.app`), valid cert |

## 2. Stripe dashboard, in live mode

**Nothing copies from test mode.** Products, prices, metadata, portal
configuration and tax settings are all per-mode and must be recreated.

1. **Activate the account** — Yasdu Innovación y Servicios SA de CV, RFC, bank
   details. Live mode is locked until this clears, and it is the long pole.
2. **Recreate the products and prices.** Starter is never a Stripe product — it is
   the absence of a subscription.

   | | Pulse Pro | Pulse Business |
   | --- | --- | --- |
   | Price | $6 USD | $12 USD |
   | Recurring | monthly, in arrears | monthly, in arrears |
   | Pricing model | **standard per-unit** (billed by `quantity` = seats) | same |
   | **Product** metadata | `tier` = `pro` | `tier` = `business` |
   | **Price** metadata | `tier` = `pro` | `tier` = `business` |
   | Tax behaviour | **inclusive** | **inclusive** |

   - **Standard per-unit, not package or tiered.** Checkout sends
     `line_items: [{ price, quantity: seats }]` (`billing.ts:575`); per-unit is what
     makes seat math come out right.
   - **Tax-inclusive** is PL1: the $6 already contains the 16% IVA. Left exclusive
     or unspecified, a Mexican customer is charged $6.96 and the published price is
     wrong.
3. **The `tier` metadata goes on the Product *and* the Price**, and the Product is
   the one that matters. `priceForTier` (`billing.ts:501`), which Checkout uses to
   *find* the price, matches on **product metadata only** — tag just the Price and
   Checkout fails outright with *"No active Stripe price is tagged with tier"*.
   `licensedItem` (`:102`), which the webhook uses to read the tier back, tries
   product first then falls back to price, which is why the Price copy is worth
   having too. (`Plans-Spec.md` §9.6 B said "every Price" until 2026-08-13.)

   **Name it "Pulse Pro" with `tier: "pro"` from the start.** The test-mode catalog
   is still "Pulse Teams" / `tier: "teams"`, which `readTier` tolerates via a legacy
   alias — a fresh live catalog means that alias never has to matter, and invoices
   read correctly from the first charge.

   If you use the dashboard's **"Copy to live mode"** shortcut, open the copied
   product afterwards and confirm `tier` actually came across on both the product
   and the price. Metadata is the one thing that must be right, and a silently
   empty copy fails at Checkout, not at copy time.
4. **Enable Stripe Tax** and add the MX registration. `automatic_tax: { enabled:
   true }` is hardcoded (`billing.ts:583`); without it **every** Checkout call
   throws. IVA is 16%, VAT-inclusive, charged in USD (PL10).
5. **Save the Customer Portal configuration** once. It 400s until you do, and
   `createPortalSession` says exactly that in its error.
6. **Create the live webhook endpoint** at the URL in §1, subscribed to exactly
   the events the code acts on (`subscriptionIdFor`, `billing.ts:336`):
   `customer.subscription.created`, `.updated`, `.deleted`, `.paused`,
   `.resumed`, `.trial_will_end`, `checkout.session.completed`, `invoice.paid`,
   `invoice.payment_failed`, `invoice.payment_succeeded`.
   Anything else is answered `200 ignored`, so over-subscribing is harmless —
   under-subscribing is not.
7. **Configure dunning retries.** The 15-day `DELINQUENCY_GRACE_DAYS` window
   assumes Stripe retries and *then* emits `customer.subscription.deleted`; that
   event is what triggers the PL4 demotion. With retries off, a single failed
   charge cancels immediately and the grace window never happens.

## 3. Secrets and redeploy

```
npx firebase functions:secrets:set STRIPE_SECRET_KEY --project pulse-b9d96      # sk_live_…
npx firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project pulse-b9d96  # the new whsec_…
npx firebase deploy --only functions --project pulse-b9d96
```

**The redeploy is not optional and this is the step most likely to be skipped.**
Secret *versions* are bound at deploy time: setting a new version leaves the
running instances pinned to version 1, still using the test key, with no error
anywhere. Confirm afterwards with `functions:secrets:get` that a version 2 exists
and that the functions were rebuilt.

`npm run deploy` is **hosting only**. Functions and rules each deploy separately —
see `CLAUDE.md`.

## 4. Data cleanup — the step with teeth

> ✅ **Done 2026-08-14.** `functions/scripts/stripe-cutover-cleanup.mjs --apply`
> cleared `stripeCustomerId` from one workspace (`personal-R9oq…`, test customer
> `cus_V1sQ7J0rSlHk6M`). There were **no** `billing/{orgId}` docs, no stale
> subscription ids, and no collapsed `editorUids`. A re-run reports all zeros.
>
> The zeros were the more informative result: a customer existed with **no**
> subscription and **no** billing doc, which says a test Checkout was opened and
> never completed. So `checkout.session.completed` never fired and
> `syncSubscription` has **never run against a real Stripe delivery** — see §6.

Test-mode identifiers are already in production Firestore and are **invalid**
against a live key. Left alone, they produce failures that look like bugs.

| Field | Why it breaks | Action |
| --- | --- | --- |
| `workspaces/*.stripeCustomerId` | holds a test `cus_…`. `ensureCustomer` (`billing.ts:514`) short-circuits on an existing id, so a live Checkout gets a test customer → *"No such customer"*, permanently, for every workspace that ever touched billing | **clear** |
| `workspaces/*.stripeSubscriptionId` | same, stale | **clear** |
| `billing/{orgId}` | test subscriptions granted real paid tiers to orgs that never paid | **delete** (or reset to Starter) |
| `workspaces/*.editorUids` | a test-mode PL4 downgrade may have collapsed it to `[ownerId]` | **audit**, restore intended editors |

`billing/{orgId}` is `write: if false`, so this cleanup runs through the Admin SDK
or the Firestore console — not from the client.

Do this **after** §3, in a quiet window: between clearing and the first live
Checkout, any affected org sees billing as Starter.

## 5. Code change (done)

`DEFAULT_RETURN_ORIGIN` (`billing.ts:465`) moved from `pulse-b9d96.web.app` to
`https://pulse.yasdu.com`. Its comment made this conditional on the domain
resolving with a valid certificate; both were verified before the change (§1).
The Firebase origins remain in `ALLOWED_RETURN_ORIGINS`, so a returnUrl from
either host still works — only the *fallback* moved.

Ships with the §3 functions deploy. The integration test now separates `FALLBACK`
from `APP`, which had been the same constant.

## 6. Verify, with real money

Stripe **test clocks do not exist in live mode**, so verification means a real
card.

> ⚠️ **This is not a re-check of something known to work — it is the first
> end-to-end run of the webhook, with real money.** §4 established that no test
> Checkout ever completed, so signature verification, `syncSubscription`, the org
> resolution chain and the `billing/{orgId}` write have never been exercised by an
> actual Stripe delivery. Do it with the Stripe **webhook log open** and read the
> delivery response rather than assuming success. A throw returns 500 and Stripe
> retries, so a failure is recoverable and visible — but only if someone is
> watching.

1. Subscribe a throwaway workspace to **Pro, 1 seat** ($6) with a real card.
2. Confirm the webhook delivered `200` in the Stripe dashboard, and that
   `billing/{workspaceId}` shows `tier: "pro"`, `status: "active"`,
   `source: "stripe"`, the right `seats` and `renewsAt`.
3. Confirm `workspaces/{id}.stripeCustomerId` is a **live** `cus_…`.
4. Open the Customer Portal from Billing & payment; confirm it loads (it 400s if
   step 2.5 was missed).
5. Check the invoice shows IVA at 16%.
6. **Cancel and refund.** Then confirm the PL4 downgrade ran: editors demoted to
   full viewer, `editorUids` collapsed to `[ownerId]`.

## 7. Rollback

If live billing misbehaves, set the secrets back to test keys and redeploy
functions (§3). That stops live charges immediately. It does **not** unwind money
already taken — refund in the Stripe dashboard — and it does **not** restore any
`billing/{orgId}` doc the live webhook overwrote.

> ⚠️ **You cannot roll back by reverting to the previous secret version.**
> `functions:secrets:set` **destroys** the prior version rather than disabling it —
> confirmed on the 2026-08-13 cutover, where both secrets went to version 2
> ENABLED with version 1 `DESTROYED`. The old test values are gone from Secret
> Manager, so rolling back means fetching the **test** `sk_test_…` and its
> test-mode `whsec_…` from the Stripe dashboard again and setting them as a new
> version. Budget a few minutes for that; it is not a one-command undo.
>
> The same mechanic makes the §3 redeploy **time-critical**, not merely required:
> between `secrets:set` and the redeploy, the deployed functions are still pinned
> to a version that no longer exists, so any cold start of `stripeWebhook`,
> `createCheckoutSession` or `createPortalSession` fails to mount its secret.
> Warm instances keep serving, which makes the window easy to miss. Run the
> redeploy immediately after setting the secrets.

## 8. Known sharp edges (not blockers)

- **`prices.list` is unpaginated** (`limit: 100`, `billing.ts:502`). Correct now;
  silently wrong past 100 active recurring prices, where the tier's price could
  fall off the page and Checkout would report no price for the tier.
- **The webhook handler has no automated test.** `functions/test/billing.integration.mjs`
  covers the pure mappers and the PL4 downgrade against the emulator, but
  verifying a real signature needs the Stripe CLI (`stripe listen`), which the
  harness doesn't have. The signature path is exercised for the first time by a
  real delivery.
- **A subscription created straight from the Stripe dashboard** carries no
  `workspaceId` metadata and resolves only by reverse lookup on
  `stripeCustomerId` (`resolveOrgId`, `billing.ts:137`). If that field was cleared
  in §4 and never re-linked, the delivery resolves to no org and is dropped.
- **The two `tier` lookups disagree by design** (§2.3): Checkout matches product
  metadata only, the webhook accepts either. A catalog tagged only on the Price
  therefore fails at *Checkout* while looking perfectly correct to anyone reading
  the webhook code. Worth collapsing to one helper the next time this file is
  touched, so the catalog can't satisfy one path and not the other.

## 9. Decisions

1. **GL1 — Ship live billing before rules-side quota enforcement?** ⛔ **OPEN.**
   Everything in §2–§6 works without it; what's missing is that a paid limit is
   advisory. *Recommendation: acceptable at launch only if the first customers are
   known and few — the exposure is an org quietly exceeding its tier, not a
   security hole (the plan itself is already unwritable). It should not outlive
   the first handful of paying orgs.*
2. **GL2 — CFDI invoicing before the first Mexican customer?** ⛔ **OPEN — needs
   an answer from outside engineering.** Not a code question; PL10-a deferred
   invoicing and that deferral was never revisited against the reality of billing
   as an SA de CV.
3. **GL3 — Fallback return origin. ✅ RESOLVED: `https://pulse.yasdu.com`.** The
   condition its comment set (resolves + valid certificate) was verified before
   changing it. *Rejected: leaving it on the Firebase URL* — a customer who is
   bounced back after paying lands on a different origin and, because Firebase
   Auth state is per-origin, **signed out** immediately after a payment.
4. **GL4 — One Firebase project for test and live. ✅ ACCEPTED for now, with
   §4 as the cost.** *Rejected: standing up a separate dev project* — it is the
   textbook answer and it is right eventually, but it means a second Firestore, a
   second set of secrets, a second hosting site and a data seeding story, none of
   which is a cutover-day task. Revisit before the next Stripe-touching change,
   because §4 is a manual cleanup that only exists because of this.
