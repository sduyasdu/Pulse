# Billing scheme & limits


The hardest part of billing is not taking money. It is that **the plan is a
security boundary** and everything about it wants to leak into the client.

## 3.1 Decide the model before the schema

Answer, and write down:

- **What is billed?** A user, a seat, a workspace, usage? "Seat" needs a
  definition precise enough to count: which roles consume one?
- **Who is the billing entity?** Almost never the individual user. Pick the
  organization/workspace and make its id the billing key.
- **Feature gating or quota only?** Quota-only (all tiers get all features,
  differing by limits) is dramatically simpler: a downgrade never removes a
  capability, only caps growth, so there is no "what happens to the data" design
  work per feature.
- **What happens on downgrade?** Decide before you can be downgraded. Graceful
  and non-destructive: demote roles, make things read-only, never delete.

## 3.2 The plan document is server-written, always

```
match /billing/{orgId} {
  allow read: if <org admin>;
  allow write: if false;      // ← the whole security model in one line
}
```

Written only by your webhook handler through an admin SDK that bypasses rules.
If a client can write its own tier, every user is on the top plan.

## 3.3 Webhooks are at-least-once and out of order

Design for redelivery from the start:

- **Recompute from current state**, don't apply deltas. Refetch the subscription
  from the provider and rebuild the document; a duplicate delivery then converges
  instead of double-applying.
- **Drop stale deliveries** by comparing the event's timestamp to the one you
  last applied, and make a repeat of the same event id a no-op.
- **Return 5xx to ask for a retry, 4xx to stop it.** A bad signature is 4xx; your
  own failure is 5xx.
- Verify the signature **over the raw body**. Any JSON re-serialization breaks it.

## 3.4 Quota enforcement needs a counter, and the counter needs an owner

Rules can't count a collection. So:

1. A server function maintains `org.thingCount` on create/delete.
2. Rules read that counter and the plan document to gate creates.
3. Rules reject any client write to the counter — an owner who can set their own
   counter to 0 makes the gate decoration.

**Recount, don't increment.** Triggers are at-least-once; an incremented counter
drifts upward on redelivery and never repairs itself. A recount is idempotent and
self-healing. Use the datastore's count aggregation so it stays cheap.

Accept and document that the counter is **async**: a burst can transiently allow
one past the cap. That's fine for a commercial quota. Say so in the code, so
nobody later mistakes it for a security boundary.

**Check every new gate against the delete path.** Deleting is how an over-quota
org gets back under its limit; gate deletes and you strand them permanently. More
generally: if your delete is a client-side cascade, *any* new write restriction
also applies to that teardown.

## 3.5 The client gate is UX, and it can be wrong

Show the limit, explain it, offer the upgrade — but:

- **Don't disable the action on a stale counter.** An async counter can be
  wrong in both directions; blocking locally denies work the server would have
  allowed. Let the server decide and render its answer.
- **Map the permission error to a human sentence.** "Missing or insufficient
  permissions" is a terrible way to meet a paywall.
- **Make dismissible notices actually dismissible** — session and permanent —
  and key the permanent dismissal to the *fact* (including the limit), so
  upgrading and hitting the new limit is allowed to speak again.

## 3.6 Never duplicate the price

A hardcoded price constant *will* drift from the provider's catalog, and the
place it becomes visible is the screen immediately before payment. Read prices
from the provider (a cached, unauthenticated endpoint is fine — it's public
pricing) and render those.

Stronger: **resolve the displayed price and the charged price through the same
code path**, so they cannot disagree by construction rather than by discipline.
In Pulse, display and checkout had separate lookups whose rules differed
slightly, and one advertised a price the other refused to sell.

## 3.7 Payment-provider realities that are not obvious

Learned the hard way; check each against your provider:

- **Some objects are immutable once set.** A customer's currency, for example.
  Not editable, ever. That means an object created too early — at *click* rather
  than at *purchase* — can permanently constrain a customer. Defer creating
  provider-side records until the transaction actually completes.
- **Abandoned sessions still exist.** Closing the browser tab tells the provider
  nothing; a checkout session stays open server-side for hours and can hold
  locks. Set the shortest sensible expiry, and expire stale sessions explicitly
  when starting a new one.
- **Card networks have currency rules.** At least one major network will refuse
  a cross-currency charge outright in some markets, so "we bill in USD
  everywhere" can silently exclude a whole card brand. Multi-currency pricing may
  be a payments requirement, not a nicety.
- **Resolve the catalog from products, not prices.** Tag the product with your
  tier and use its default price; then adding a currency or a promo price
  requires no re-tagging and there is no ambiguity when a tier has several
  prices.
- **Never enter card details in your own UI.** Hosted checkout/portal only.
- **Configuration is per-mode.** Test-mode products, webhooks, tax settings and
  portal configuration do not cross to live. Assume nothing carries over.

## 3.8 Error messages must not guess

An error that names a *likely* cause will confidently misdirect the day the
cause is something else. Ours claimed a tax-configuration problem and sent us
looking there twice while the real causes — an invalid key, then a currency
conflict — sat in the logs. Surface the provider's own message for configuration
errors; keep the guess out of it.
