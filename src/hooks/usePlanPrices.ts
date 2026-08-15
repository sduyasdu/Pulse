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
 * Live plan prices for the plans form (Plans-Spec PL14).
 *
 * The dialog used to render `TIER_PRICE_USD`, a hardcoded 6/12. That drifted the
 * moment the live catalog moved to MXN — the form advertised "$6 USD" while
 * Checkout charged pesos, on the screen immediately before payment.
 *
 * Stripe is asked once per mount. **Failure is not fatal**: an unreachable
 * catalog falls back to the built-in USD figures rather than rendering a plan
 * picker with blank prices, and `fromStripe` says which the caller is looking
 * at. Starter is always free and never a Stripe product, so it is formatted from
 * the constant either way.
 */
export function usePlanPrices(lang: string): Record<PlanTier, DisplayPrice> {
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

  const of = (tier: PlanTier): DisplayPrice => {
    if (tier === "starter") return fallback("starter"); // free by definition, never in Stripe
    const hit = plans?.find((p) => p.tier === tier);
    if (!hit || hit.unitAmount == null) return fallback(tier);
    return { formatted: formatMinorUnits(hit.unitAmount, hit.currency, lang), fromStripe: true };
  };

  return { starter: of("starter"), pro: of("pro"), business: of("business") };
}
