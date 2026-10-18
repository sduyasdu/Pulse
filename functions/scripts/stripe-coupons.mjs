/**
 * Beats' discount codes (Trials-and-Referrals-Spec TR15–TR17): a Stripe coupon marked
 * `metadata.beats = 'yes'` and naming ONLY Beats' Pro and Business products, and its
 * promotion code. Checkout keeps Stripe's own promotion-code box (TR15), which accepts any
 * active code in the shared Yasdu account — so the separation between products is made on
 * the coupon: `applies_to.products` is what Stripe enforces, and it then refuses a Beats
 * code on Foretrue and a Foretrue code here.
 *
 * DRY RUN unless `--apply`. A code that exists is reported and left alone. Run from the
 * repo root, after `npm --prefix functions install`:
 *
 *   STRIPE_KEY=sk_test_… node functions/scripts/stripe-coupons.mjs create --code BEATS20 --percent 20 --months 3 --max 100 --expires 2026-12-31 [--first-time] [--tiers pro,business] [--apply]
 *   STRIPE_KEY=sk_test_… node functions/scripts/stripe-coupons.mjs create --code WELCOME --usd 6 --mxn 120 --months 1 --max 50 [--apply]
 *   STRIPE_KEY=sk_test_… node functions/scripts/stripe-coupons.mjs list
 *
 * Duration is `--months N` or `--forever`. `--once` is REFUSED until TR17 is verified in
 * test mode: if Stripe spends a `once` coupon on a free month's $0 invoice, the customer
 * loses it. A `repeating` code counts its months from the subscription's start, so a
 * 3-month code meant to follow a free month is made `--months 4`.
 *
 * A fixed amount needs BOTH currencies the catalog sells in (PL13). Refused (TR16): a 100%
 * coupon for longer than one month — that is a grant, `scripts/grant-business.cjs` — and a
 * coupon with neither `--expires` nor `--max`, which is a price change.
 */
import Stripe from "stripe";

const key = process.env.STRIPE_KEY ?? "";
if (!/^(sk|rk)_(test|live)_/.test(key)) {
  console.error("Set STRIPE_KEY to a secret key (sk_test_… or sk_live_…).");
  process.exit(1);
}
const mode = key.includes("_live_") ? "LIVE" : "test";
const [command, ...argv] = process.argv.slice(2);
const apply = argv.includes("--apply");
const has = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : (argv[i + 1] ?? null);
};
const number = (name) => {
  const v = value(name);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const fail = (why) => {
  console.error(`Refused: ${why}`);
  process.exit(1);
};

const stripe = new Stripe(key);

if (command === "list") {
  for await (const promo of stripe.promotionCodes.list({ limit: 100, expand: ["data.promotion.coupon"] })) {
    const c = typeof promo.promotion?.coupon === "object" ? promo.promotion.coupon : null;
    if (c?.metadata?.beats !== "yes") continue;
    const off = c.percent_off !== null ? `${c.percent_off}%` : `${c.amount_off} ${c.currency}`;
    const length = c.duration === "repeating" ? `${c.duration_in_months} months` : c.duration;
    const expires = promo.expires_at ? ` · expires ${new Date(promo.expires_at * 1000).toISOString().slice(0, 10)}` : "";
    console.log(`${promo.code.padEnd(16)} ${off} ${length} · used ${promo.times_redeemed}/${promo.max_redemptions ?? "∞"} · ${promo.active ? "active" : "inactive"}${expires}`);
  }
  process.exit(0);
}
if (command !== "create") fail("say `create` or `list`.");

const code = (value("code") ?? "").toUpperCase();
if (!/^[A-Z0-9_-]{2,40}$/.test(code)) fail("--code is 2 to 40 letters, digits, - or _.");
const percent = number("percent");
const usd = number("usd");
const mxn = number("mxn");
const months = number("months");
const max = number("max");
const expiresRaw = value("expires");
if (has("once")) fail("--once is not offered until TR17 is verified in test mode; use --months N (count the free month in N).");
if ([months !== null, has("forever")].filter(Boolean).length !== 1) fail("give exactly one of --months N, --forever.");
if ((percent === null) === (usd === null && mxn === null)) fail("give --percent, or --usd and --mxn.");
if (percent !== null && !(percent > 0 && percent <= 100)) fail("--percent is above 0 and at most 100.");
if (percent === null && !(usd > 0 && mxn > 0)) fail("a fixed amount needs both --usd and --mxn, above 0 (PL13).");
if (months !== null && !(Number.isInteger(months) && months >= 1 && months <= 36)) fail("--months is a whole number from 1 to 36.");
if (max !== null && !(Number.isInteger(max) && max >= 1)) fail("--max is a whole number of uses, 1 or more.");
const expires = expiresRaw ? Math.floor(Date.parse(`${expiresRaw}T23:59:59Z`) / 1000) : null;
if (expiresRaw && (!expires || expires * 1000 < Date.now())) fail("--expires is a date in the future, YYYY-MM-DD.");
// TR16: a grant is not a coupon, and an open-ended discount is a price.
if (percent === 100 && (has("forever") || (months ?? 1) > 1)) fail("a 100% coupon for longer than a month is a grant — use scripts/grant-business.cjs.");
if (!expires && max === null) fail("give --expires or --max: a discount with neither is a price change.");

const existing = await stripe.promotionCodes.list({ code, limit: 1 });
if (existing.data.length > 0) {
  console.log(`${code} exists already (${existing.data[0].id}); nothing to do.`);
  process.exit(0);
}

// Beats' products are the ones tagged with a tier — the same reading as billing.ts's
// tierCatalog, including the legacy "teams" name for Pro.
const tierOf = (meta) => {
  const t = meta?.tier?.trim().toLowerCase();
  return t === "teams" ? "pro" : t === "pro" || t === "business" ? t : null;
};
const wanted = (value("tiers") ?? "pro,business").split(",").map((x) => x.trim()).filter(Boolean);
for (const t of wanted) if (t !== "pro" && t !== "business") fail("--tiers names pro and/or business.");
const products = [];
for await (const product of stripe.products.list({ active: true, limit: 100 })) {
  const tier = tierOf(product.metadata);
  if (tier && wanted.includes(tier)) products.push(product.id);
}
if (products.length === 0) fail(`no active Beats product tagged ${wanted.join(" or ")} in ${mode} mode.`);

const coupon = {
  name: `Beats ${code}`,
  ...(percent !== null
    ? { percent_off: percent }
    : { amount_off: Math.round(usd * 100), currency: "usd", currency_options: { mxn: { amount_off: Math.round(mxn * 100) } } }),
  duration: has("forever") ? "forever" : "repeating",
  ...(months !== null ? { duration_in_months: months } : {}),
  // TR15: Stripe refuses it on any product not named here — Foretrue's included.
  metadata: { beats: "yes" },
  applies_to: { products },
};
const promotion = {
  code,
  ...(max !== null ? { max_redemptions: max } : {}),
  ...(expires ? { expires_at: expires } : {}),
  ...(has("first-time") ? { restrictions: { first_time_transaction: true } } : {}),
  metadata: { beats: "yes" },
};
console.log(`${apply ? "APPLYING" : "DRY RUN — add --apply"} · ${mode} mode`);
console.log("coupon", JSON.stringify(coupon));
console.log("promotion code", JSON.stringify(promotion));
if (!apply) process.exit(0);
const made = await stripe.coupons.create(coupon);
const promo = await stripe.promotionCodes.create({ ...promotion, promotion: { type: "coupon", coupon: made.id } });
console.log(`made ${promo.code} (${promo.id}) on coupon ${made.id}`);
