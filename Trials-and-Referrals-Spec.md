# Beats — Free Trial, Referrals & Discount Codes Spec

Status: **specified 2026-10-18, NOT built.** The owner accepted §6's recommendations the
same day, all but one: a referral earns a **flat $12**, not a month of the referrer's bill
(`TR12`, decided after a second look at the options). · Owner: product + eng ·
Related: `Plans-Spec.md` (PL1 tiers, PL4 downgrade, PL6 org = workspace, PL13–PL17
currencies), `Server-Functions-Spec.md` (SF3 billing sync), `Stripe-Go-Live-Runbook.md`.

Asked for as *"make a similar spec to implement trials and recommendations in pulse"* — the
same three things Foretrue built on 2026-10-18 (Foretrue `docs/billing.md` §15, `BL30`–`BL46`),
fitted to how Beats bills. Where Beats differs, this spec follows Beats, and says why:

- **Beats prices per editor seat** — Pro $6, Business $12 a seat a month (PL1). A Stripe
  subscription's `quantity` is the seat count. Foretrue has a plan price plus bought seats.
- **A workspace is created by the CLIENT**, not in a transaction:
  `src/services/firestore/workspaces.ts:18`, called from `ensureUserDoc`
  (`src/services/firestore/users.ts:16`). Foretrue's org is made by a callable.
- **One Firebase project, and no test/live mark on a workspace** (GL4). Stripe's mode is the
  deployed key's. Foretrue stamps `env` on every org.
- **No workspace-level notifications.** The bell is per Beat, comments only
  (`src/types/index.ts:456`).
- **Stripe's own promotion-code box stays on Checkout** (decided by the owner 2026-10-18);
  Foretrue replaced its own with a checked field.

---

## 1. What exists today

- **Checkout:** `functions/src/billing.ts:709` (`createCheckoutSession`) already sets
  `allow_promotion_codes: true` (`billing.ts:762`). It sets no `trial_period_days`, no
  `payment_method_collection` and no `discounts`.
- **The webhook** already subscribes to `customer.subscription.trial_will_end`
  (`billing.ts:361`), and `trialing` is already treated as paid:
  - `holdsSeats` (`billing.ts:144`)
  - `tierOf` (`src/domain/entitlements.ts:80`)
  - the rules' `planTierOf` (`firestore.rules:65`)
  - `ACTIVE_STATUSES` (`functions/src/mcp.ts:135`, `rosterCopy.ts:28`)

  `planNotice` returns nothing for `trialing`.
- **Plan state** lives in `billing/{orgId}`, which the client cannot write
  (`firestore.rules:359-362`).
- **A gap this spec must close:** the workspace document's owner may write every field
  except `pulseCount` (`SERVER_COUNTERS`, `firestore.rules:52`, `259-272`). That includes
  `stripeCustomerId`, `stripeSubscriptionId`, `country` and `editorUids`. Any trial or
  referral field placed on the workspace would be the owner's to reset.

---

## 2. The free month (`TR1`–`TR7`)

**What the owner sees.**
- **On Free:** Starter's Upgrade, for an org that has never had a trial, offers **Start a
  free month** on Pro and Business.
- **At Checkout:** the card is asked for; the page says nothing is charged for 30 days and
  what is charged then.
- **During the month:** the Billing dialog and `planNotice` read *"Pro — free trial until
  17 Nov · then $18 a month for 3 seats on Visa ending 4242"*.

**One trial per workspace, ever, and per person and card** (`TR1`). An org has ONE trial in its
life, whatever the tier: never Pro then Business, and never again once a trial has ended —
paid, cancelled or failed. The org must also never have had a subscription. Kept by the
server only:
- **`billing/{orgId}.trialUsedAt`.** `billing/*` is already server-only.
- **`trialPeople/{uid}`** for the owner who started it: a new server-only collection, never
  `users/{uid}`, which the client writes. A person with a second workspace does not get a
  second trial.
- **`trialCards/{livemode}_{fingerprint}`**: on `checkout.session.completed` for a trialing
  subscription, the payment method's card fingerprint is recorded. A fingerprint that
  started a trial for another workspace ends the new one at once (`trial_end: 'now'`).
  The same happens to an org or person that already had one, if two checkouts raced.
  `livemode` comes from the event, since Beats has no env field (GL4).

**Seats during the trial** (`TR2`). Every item of a trialing subscription is free, and in
Beats the seats ARE the subscription. So:
- **At Checkout:** the trial starts with the seats chosen there, at most **5**.
- **During the month:** seats cannot be added. The Billing dialog says so, with **End the
  free trial to add seats**: a quote of the first invoice and the card, then
  `subscriptions.update({ trial_end: 'now' })`.
- **Through the portal:** seat changes there are not trusted to wait. A
  `customer.subscription.updated` that RAISES the quantity while `trialing` ends the trial
  at once, in the webhook, and the owner sees it ended in the dialog. Lowering seats is
  free and allowed.

This mirrors Foretrue's "no extra seats during a trial" (`BL33`), fitted to a product where
seats are the whole price.

**How it is made in Stripe** (`TR3`).
- **Checkout:** `subscription_data.trial_period_days: 30`,
  `subscription_data.trial_settings.end_behavior.missing_payment_method: 'cancel'`, and
  `payment_method_collection: 'always'`. The card is asked at the start, so the month
  converts by itself.
- **Eligibility:** read in `createCheckoutSession` from `billing/{orgId}`, `trialPeople/{uid}`
  and the org's Stripe customer. `TR1`'s marks are written by the webhook, not at Checkout,
  so an abandoned Checkout burns nothing.

**Before it ends** (`TR4`).
- **No bell:** Beats has no workspace-level one, so `trial_will_end` (already subscribed)
  sets `billing/{orgId}.trialEndingAt`.
- **A notice instead:** `planNotice` gains a `trialing` case, shown to the owner from three
  days before: the date, the amount and the card, with a link to Billing.
- **Stripe's own email:** the trial-reminder email is switched on in the Dashboard, a
  runbook step.
- **Not chosen:** a workspace-level notification channel was considered and not chosen
  (§6).

**When it ends** (`TR5`).
- **The card pays:** nothing else changes.
- **The card fails:** a trial that has never paid gets **3 days** of grace, not PL's 15
  (`DELINQUENCY_GRACE_DAYS`, `src/domain/entitlements.ts:52`). After that, PL4's downgrade
  runs.
- **How the server knows:** it needs to know the org never paid, so `billing/{orgId}` keeps
  `trialEnd` after the trial and gains `paidSince`, written on the first `invoice.paid` with
  `amount_paid > 0`.
- **Cancelled during the trial:** cancellation is set for the trial's end and nothing is
  charged; Starter follows with PL4's downgrade on that day.

**A change of tier during the trial keeps its end** (`TR6`). Pro → Business keeps the same
`trial_end`: a second tier is not a second trial.

**Not offered to:** an org granted a plan by hand (`scripts/grant-business.cjs`); an org that
has ever paid; a member's workspace — only the owner pays (PL6, `requireOwnedWorkspace`,
`billing.ts:508`) (`TR7`).

---

## 3. $12 for every friend who pays (`TR8`–`TR14`)

**What the owner sees.** The Billing dialog gains **Invite and earn**:
- **The link:** `{origin}/r/{code}`.
- **The rule:** *"For every workspace that subscribes through your link, you get $12 off"*
  (in pesos, its MXN price).
- **The counts:** signed up · subscribed · rewards earned this year · rewards waiting.

**Whose link** (`TR8`). A link belongs to a WORKSPACE (PL6: the org pays), made by its owner,
one per workspace.
- `referralCodes/{code}` → `{ workspaceId, createdBy, createdAt }`, server-only.
- The code is 8 characters, made by a callable `getReferrals({ workspaceId, create })`.

**Counting a friend** (`TR9`). Workspaces are created by the client, not in a transaction
(see the top of this spec), so the client cannot be what counts a friend. Instead:
- **Arriving:** `/r/{code}` keeps the code in the browser for 60 days, and the sign-in
  screen says *"Invited by {workspace name}"* (a `resolveReferralCode` callable returning
  the NAME only).
- **Claiming:** after `ensureUserDoc` has made the personal workspace, the client calls
  **`claimReferral({ code })`** once and forgets the code. The server counts it, in ONE
  transaction, only if:
  - the caller's personal workspace was created within the last 24 hours;
  - it has no `referredBy` yet;
  - its owner has never had a paid subscription in any workspace.

  The server writes `billing/{orgId}.referredBy` and the referrer's ledger,
  `referrals/{referrerWorkspaceId}/friends/{orgId}`, with `status: 'signed-up'`.

**Never counted** (`TR10`). Each case is recorded with its reason (`status: 'void'`), never
dropped:
- **Referring yourself:** the caller is the referring workspace's owner or one of its
  members.
- **The same card:** the friend's paying card fingerprint is one that has paid for the
  referrer (`billing/{referrerId}.paidFingerprints`).
- **Across modes:** a test-mode payment never rewards a live-mode workspace. `livemode` is
  stamped on the ledger at the friend's first payment and compared with the referrer's
  subscription.

**When a reward is earned** (`TR11`). On the friend's FIRST PAID invoice (`invoice.paid`,
`amount_paid > 0`). A converted trial counts; a cancelled trial does not. A full refund of
that invoice within 14 days (`charge.refunded`, which must be added to the endpoint) takes
back a reward not yet used.

**What a referral is worth** (`TR12`, decided by the owner 2026-10-18). A **flat credit of
one Business seat-month — $12, or the Business seat's peso price in MXN (PL13)** — for every
friend who pays, whatever the size of either team.
- **How it is given:** a credit on the referrer's Stripe customer
  (`customers.createBalanceTransaction`, negative, with an idempotency key per friend),
  which Stripe takes off the next invoices.
- **The currency:** the one the referrer's subscription is billed in.
- **On Starter, with no subscription:** the credit is banked, and given when the workspace
  subscribes — after any trial, since a balance is only taken from an invoice above zero.

Why flat. Beats prices per seat, so "a month free" is $6 for one team and $600 for another,
and it is unrelated to what the friend pays. A big workspace would have earned $300 for
bringing in a $6 customer. A flat amount is the same promise to everyone, and easy to
state: *"$12 off for every workspace that subscribes through your link."* What it gives up
is weight for a large team ($12 off $300). The alternatives were weighed (§6) and
rejected for that simplicity.

**A ceiling** (`TR13`). Twelve rewards earned per workspace per calendar year — $144 at most. Past that, a
friend is recorded `over-cap`.

**Told how** (`TR14`). With no workspace-level bell, the Billing dialog's counts show it,
and `planNotice` shows a one-time *"A workspace you invited subscribed: you earned $12 off"*
until it is dismissed. That is a dismissed-at timestamp on `billing/{orgId}`, set through a
callable.

---

## 4. Discount codes (`TR15`–`TR19`)

**Stripe's box stays** (`TR15`, decided by the owner 2026-10-18). Checkout keeps
`allow_promotion_codes: true` (`billing.ts:762`). The box accepts any active code in the
Yasdu account, so the separation between products is made ON THE COUPON, not in the box:
- **Every Beats coupon** sets `applies_to.products` to Beats' Pro and Business products, and
  carries `metadata.beats = 'yes'`. Stripe then refuses it on anything else, Foretrue
  included.
- **Foretrue's coupons** already name only Foretrue's products (Foretrue `BL43`), so Beats'
  box refuses them.
- **A coupon made by hand with no product restriction** works in both products' boxes. The
  runbook says to always restrict.

**Made by a script** (`TR16`). `functions/scripts/stripe-coupons.mjs`, dry run by default,
like Foretrue's:
```
STRIPE_KEY=sk_test_… node functions/scripts/stripe-coupons.mjs create --code BEATS20 --percent 20 --months 3 --max 100 --expires 2026-12-31 [--first-time] [--tiers pro,business] [--apply]
```
- **Amounts:** percentage by preference; a fixed amount only with both USD and MXN
  (`currency_options`, PL13).
- **It refuses:** a 100% coupon for longer than one month (that is a grant —
  `scripts/grant-business.cjs`), and a coupon with neither an expiry nor a redemption limit
  (that is a price change).

**With a trial** (`TR17`). A code entered in Checkout's box with a free month must take
effect on the first PAID invoice, not on the trial's zero one. Whether Stripe spends a
`duration: 'once'` coupon on a trial's $0 invoice is **to be verified in test mode before
launch**. Until then, Beats codes are made `repeating` (whose months count from the start
of the subscription, so a 3-month code made for a trial is given 4 months). §6 asks.

**For an org already paying** (`TR18`).
- **Today:** there is no in-app seat or plan change; changes go through the Customer
  Portal, which can be configured to accept promotion codes. The same
  `applies_to`/`metadata` rule keeps it to Beats' codes.
- **Recommended:** add an in-app code field only if the portal's turns out not to cover it
  (§6).

**One at a time** (`TR19`). A new code replaces the discount in force. Codes never stack.

---

## 5. What changes, by file (for the build)

- **`functions/src/billing.ts`:**
  - `createCheckoutSession` (`:709`): the trial terms when the org may have one (`TR3`), and
    the seat cap (`TR2`).
  - `syncSubscription` (`:226`): `trialEnd` kept, `paidSince`, the quantity-raised-in-trial
    rule (`TR2`), `trialEndingAt` (`TR4`), and the 3-day grace (`TR5`).
  - The webhook (`:410`): on `checkout.session.completed`, the trial's marks and the card
    fingerprint (`TR1`) and banked months credited (`TR12`); on `invoice.paid`, `paidSince`,
    `paidFingerprints` and the referral reward (`TR11`); `charge.refunded` added (`TR11`).
- **New callables:**
  - `endFreeTrial`: the quote, then the end.
  - `getReferrals`: the link and its counts.
  - `resolveReferralCode`: the name only.
  - `claimReferral`.
  - `dismissBillingNotice`.
- **`src/domain/entitlements.ts`:** the trial grace beside `DELINQUENCY_GRACE_DAYS`.
- **`src/domain/planNotice.ts`:** the `trialing` notice and the month-earned notice.
- **`firestore.rules`:**
  - `referralCodes`, `referrals/**`, `trialPeople`, `trialCards`: no client access.
  - The workspace's owner-writable gap (§1) closed for `stripeCustomerId`,
    `stripeSubscriptionId`, `country` — server-owned, like `pulseCount`.
- **Client:**
  - the Billing dialog (`src/components/account/BillingDialog.tsx`): Start a free month,
    the trial line, End the free trial to add seats, and Invite and earn;
  - sign-in: "Invited by";
  - the `/r/{code}` capture and `claimReferral` after `ensureUserDoc`;
  - six languages (`src/i18n/langs.ts:4`).
- **Runbook (`Stripe-Go-Live-Runbook.md`):** `charge.refunded` on both endpoints; Stripe's
  trial-reminder email on; every Beats coupon restricted to Beats' products.
- **Tests:**
  - `functions/test/billing.integration.mjs`: one trial per org, person and card; a seat
    raise in a trial ending it; the 3-day grace; a referral claimed, voided for each
    reason, rewarded once at $12, banked, capped, taken back on a refund.
  - `rules/security.test.ts`: the new collections closed, and the workspace's Stripe
    fields refused to the owner.
  - `src/services/firestore/subscriptionErrors.test.ts`: the new refusals.

---

## 6. The questions, and the owner's answers (2026-10-18)

| Asked | Answer | Why |
| --- | --- | --- |
| Card at the start of the trial, or at its end? | **At the start** (`TR3`) | The month converts by itself, and the card is the check against repeat trials. Foretrue decided the same. |
| How many seats may a trial start with? | **Up to 5** (`TR2`) | Enough to try with a team; a trial is not a free large team. |
| Seats added during a trial | **End the trial first; a raise through the portal ends it at once** (`TR2`) | In Beats the seats are the price, so a free seat is a free month of revenue. Foretrue disables extra seats in a trial for the same reason. |
| Grace after a trial that never paid | **3 days** (`TR5`) | 15 is for a customer who has paid. |
| A referral's worth | **A flat $12 — one Business seat-month — whatever the team sizes** (`TR12`; the owner chose it over the recommendation) | Simple and easy to explain. Weighed: the referrer's whole month (a $300 reward for a $6 customer), capped at 10 seats, the smaller of the two bills, and the friend's first month capped at the referrer's. |
| A ceiling | **12 months a year per workspace** (`TR13`) | Open-ended rewards are a public coupon. |
| Does the invited friend get more than the standard free month? | **No** | The free month is the welcome. |
| A workspace-level notification channel for trial and referral notices | **Not now: `planNotice` and Stripe's email** (`TR4`, `TR14`) | A new channel is its own spec; the notice already reaches the owner. |
| Discount codes for an org already paying | **Through the Customer Portal; an in-app field only if the portal's does not cover it** (`TR18`) | Beats changes subscriptions in the portal today. |
| A `once` code entered with a trial | **Verify in test mode; meanwhile make codes `repeating`** (`TR17`) | If Stripe spends `once` on the $0 trial invoice, the customer loses it. |

---

## 7. Decisions

| Code | Decision | Why | Rejected |
| --- | --- | --- | --- |
| **TR1** | **ONE free month per workspace in its life, whatever the tier, and one per person (`trialPeople/{uid}`) and card (`trialCards`, by fingerprint); a repeat is ended at once. Marked by the webhook, never at Checkout.** | A new workspace is one sign-up away; the person and the card repeat. An abandoned Checkout must not burn a trial. | A trial per tier; a mark on `users/{uid}`, which the client writes. |
| **TR2** | **A trial starts with at most 5 seats; seats are not added during it — End the free trial first — and a raise through the portal ends it at once.** | Every item of a trialing subscription is free, and the seats are Beats' whole price. | Uncapped seats; seats added free until the trial ends. |
| **TR3** | **30 days, the card asked at the start (`payment_method_collection: 'always'`), a card removed mid-trial cancelling it.** | It converts by itself. | No card until the end. |
| **TR4** | **Three days before the end: `planNotice` to the owner with date, amount and card, from `trial_will_end`, and Stripe's own reminder email.** | Nobody should be surprised by the first charge; Beats has no workspace bell. | A new notification channel for this alone. |
| **TR5** | **A trial that never paid gets 3 days of grace, then PL4's downgrade; `trialEnd` is kept after the trial and `paidSince` is written on the first paid invoice.** | 15 days on top of 30 is a 45-day trial for an expired card. | PL's 15 days for everyone. |
| **TR6** | **A change of tier during the trial keeps its end.** | A second tier is not a second trial. | A fresh trial per tier. |
| **TR7** | **Never offered to a granted plan, an org that has ever paid, or anyone but the workspace's owner.** | Only the owner pays (PL6). | — |
| **TR8** | **A referral link per WORKSPACE, made by its owner; the reward goes to that workspace.** | The workspace is the org (PL6). | A link per person. |
| **TR9** | **A friend is counted by a `claimReferral` callable after the personal workspace exists, in one transaction, only within 24 hours of its creation, once, and only for someone who has never paid.** | Workspaces are made by the client; the count must be the server's. | Trusting a `referredBy` the client writes on its own workspace. |
| **TR10** | **Never counted: yourself (owner or member of the referring workspace), a card that paid for the referrer, another Stripe mode — each recorded `void` with its reason.** | The cheap abuses, closed and explainable. | Silent drops. |
| **TR11** | **A reward is earned on the friend's first PAID invoice; a full refund within 14 days takes back an unused one.** | A reward for a customer, not a sign-up. | Rewarding the sign-up or the trial start. |
| **TR12** | **A referral earns a flat credit of one Business seat-month — $12, or its MXN price — on the referrer's Stripe customer, whatever either team's size; banked on Starter and given at its first subscription.** Decided by the owner 2026-10-18. | Beats prices per seat, so "a month" ranges from $6 to hundreds and has nothing to do with what the friend pays; a flat amount is one promise, easy to state. | The referrer's month (uncapped or capped at 10 seats); the smaller of the two bills; the friend's first month capped at the referrer's; a 100% coupon. |
| **TR13** | **At most 12 rewards ($144) per workspace per calendar year; past it, `over-cap`.** | Open-ended rewards are a public coupon. | No ceiling. |
| **TR14** | **Earned rewards are told in the Billing dialog's counts and a dismissable `planNotice`.** | No workspace bell; the owner reads Billing. | A new channel. |
| **TR15** | **Checkout keeps Stripe's promotion-code box; products are kept apart on the coupon — every Beats coupon names Beats' products only and carries `metadata.beats = 'yes'`.** Decided by the owner 2026-10-18. | The box accepts any code in the shared account; `applies_to` is what Stripe enforces. Foretrue's coupons already name only Foretrue's products. | Replacing the box (Foretrue's choice for Foretrue). |
| **TR16** | **Codes are made by `stripe-coupons.mjs`, dry run by default; it refuses a 100% coupon longer than a month and a coupon with neither expiry nor redemption limit.** | A grant is `grant-business.cjs`; an open-ended discount is a price. | Any coupon Stripe allows. |
| **TR17** | **Whether a `once` code is spent on a trial's $0 invoice is verified in test mode before launch; until then Beats codes are `repeating`.** | A first-month code must not vanish into a free month. | Assuming Stripe's behaviour. |
| **TR18** | **An org already paying applies a code through the Customer Portal; an in-app field only if the portal does not cover it.** | Beats changes subscriptions in the portal. | An in-app field first. |
| **TR19** | **One discount per subscription; a new code replaces the old.** | Stacked codes make every price a puzzle. | Stacking. |
