import { useEffect, useState } from "react";
import { listPlanPrices, type PlanPrice } from "@/services/firestore/billing";
import { TIER_PRICE_USD } from "@/domain/entitlements";
import type { PlanTier } from "@/types";

/** What to render for one tier's price, already formatted for the active
 * language. `fromStripe` is false while showing the built-in fallback. */
export interface DisplayPrice {
  formatted: string;
  fromStripe: boolean;
}

/** Stripe stores minor units (600 = $6.00), except in zero-decimal currencies
 * where 600 means 600. Intl knows which is which per currency, so dividing by
 * 100 unconditionally would be wrong for JPY and friends — ask Intl instead. */
export function formatMinorUnits(minor: number, currency: string, lang: string): string {
  const fmt = new Intl.NumberFormat(lang, { style: "currency", currency: currency.toUpperCase() });
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  return fmt.format(minor / 10 ** digits);
}

/**
 * Live plan prices for the plans form (Plans-Spec PL14/PL17).
 *
 * The dialog used to render `TIER_PRICE_USD`, a hardcoded 6/12, which drifted
 * the moment the live catalog changed. Stripe is now the source for what is
 * displayed, exactly as it already is for what is charged — and the displayed
 * currency is then passed to Checkout, so the two cannot disagree.
 *
 * Stripe is asked once per mount. **Failure is not fatal**: an unreachable
 * catalog falls back to the built-in USD figures rather than rendering a plan
 * picker with blank prices, and `fromStripe` says which the caller is looking
 * at. Starter is always free and never a Stripe product, so it is formatted
 * from the constant either way.
 */
export function usePlanPrices(lang: string) {
  const [plans, setPlans] = useState<PlanPrice[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listPlanPrices()
      .then((p) => { if (!cancelled) setPlans(p); })
      .catch(() => { if (!cancelled) setPlans([]); }); // fall back, don't blank the picker
    return () => { cancelled = true; };
  }, []);

  const fallback = (tier: PlanTier): DisplayPrice => ({
    formatted: formatMinorUnits(TIER_PRICE_USD[tier] * 100, "usd", lang),
    fromStripe: false,
  });

  /** Is this tier actually purchasable in this currency? A tier may be
   * configured for fewer currencies than another — Business has no ARS today —
   * and offering one Stripe would reject is worse than not offering it. */
  const has = (tier: PlanTier, currency: string): boolean =>
    tier !== "starter" && typeof plans?.find((p) => p.tier === tier)?.amounts?.[currency] === "number";

  /** The price to show for a tier in a currency, falling back to the built-in
   * USD figure when Stripe is unreachable or the currency isn't configured. */
  const priceOf = (tier: PlanTier, currency: string): DisplayPrice => {
    if (tier === "starter") return fallback("starter"); // free by definition, never in Stripe
    const amount = plans?.find((p) => p.tier === tier)?.amounts?.[currency];
    if (typeof amount !== "number") return fallback(tier);
    return { formatted: formatMinorUnits(amount, currency, lang), fromStripe: true };
  };

  /** Currencies every paid tier can be bought in — the ones a currency switch
   * may safely offer. */
  const currencies = (): string[] => {
    const paid: PlanTier[] = ["pro", "business"];
    const all = new Set<string>();
    for (const p of plans ?? []) for (const c of Object.keys(p.amounts)) all.add(c);
    return [...all].filter((c) => paid.every((tier) => has(tier, c)));
  };

  return { priceOf, has, currencies, loaded: plans !== null };
}
