import { useState } from "react";
import { InlineSpinner } from "@/components/shared/Spinner";
import { useBilling } from "@/hooks/useBilling";
import { usePlanPrices } from "@/hooks/usePlanPrices";
import { createCheckoutUrl, createPortalUrl } from "@/services/firestore/billing";
import {
  ALL_TIERS,
  TIER_ENTITLEMENTS,
  DELINQUENCY_GRACE_DAYS,
  delinquency,
  editorSeatLimit,
  tierOf,
} from "@/domain/entitlements";
import { useT, type TFn } from "@/i18n";
import { useI18nStore } from "@/stores/i18nStore";
import type { PlanTier } from "@/types";

/**
 * "Billing & payment" — the three plans side by side, what the org is on now,
 * and the way out to Stripe's hosted flows (Plans-Spec §6). Read-only by
 * construction: `billing/{orgId}` is server-authoritative (SF3 is its only
 * writer), so every button here is a redirect and the change lands back through
 * the webhook.
 *
 * Owner-only in practice — only a workspace owner may read `billing/{orgId}`, so
 * everyone else sees the free-tier view of their own org.
 */

/** `null` = unlimited (Plans-Spec §3). */
const limit = (n: number | null, t: TFn) => (n === null ? t("billing.unlimited") : String(n));

/** Formatted in the app's active language, not the browser's — the user may
 * have overridden it in the account menu. */
function formatDate(ms: number | undefined, lang: string): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric" });
}

/** Product terms, left untranslated like Pulse and Epic (see i18n/en.ts). */
const TIER_LABEL: Record<PlanTier, string> = { starter: "Starter", pro: "Pro", business: "Business" };

function PlanColumn({
  tier,
  current,
  subscribed,
  busy,
  price,
  onChoose,
  onChooseMxn,
  t,
}: {
  tier: PlanTier;
  current: boolean;
  subscribed: boolean;
  busy: boolean;
  /** Already formatted, and sourced from Stripe where available (PL14) — the
   * column no longer decides what a tier costs. */
  price: string;
  onChoose: () => void;
  /** Temporary: starts Checkout forced to MXN, to verify the price's
   * `currency_options` entry resolves. Absent on Starter. */
  onChooseMxn?: () => void;
  t: TFn;
}) {
  const limits = TIER_ENTITLEMENTS[tier];

  // The action depends on whether a subscription already exists, NOT on which
  // tier was clicked: sending an existing subscriber through Checkout would open
  // a SECOND subscription rather than move them. Stripe's portal is the only
  // correct place to switch plans, change seats, or cancel down to Starter.
  const label = current
    ? t("billing.currentPlan")
    : subscribed
      ? t("billing.switchPlan")
      : tier === "starter"
        ? t("billing.currentPlan")
        : t("billing.selectPlan");

  return (
    <div
      className="flex flex-col rounded-xl border p-4"
      style={{
        borderColor: current ? "#D85A28" : "#E2DFD9",
        background: current ? "#FFF7F2" : "#FFFFFF",
        boxShadow: current ? "0 0 0 1px #D85A28 inset" : "none",
      }}
    >
      <div className="flex items-center gap-2">
        <span className="font-display text-sm font-semibold" style={{ color: "#1F2330" }}>{TIER_LABEL[tier]}</span>
        {tier === "starter" && (
          <span className="mono rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide" style={{ background: "#EEF1F5", color: "#94A3B8" }}>
            {t("billing.free")}
          </span>
        )}
      </div>

      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-display text-xl font-semibold" style={{ color: "#1F2330" }}>{price}</span>
        <span className="text-[11px]" style={{ color: "#94A3B8" }}>{t("billing.perEditorMonth")}</span>
      </div>

      <dl className="mt-3 flex flex-1 flex-col gap-1.5 border-t pt-3" style={{ borderColor: "#F1F5F9" }}>
        {[
          [t("billing.editorSeats"), tier === "starter" ? "1" : t("billing.perSeat")],
          [t("billing.maxPulses"), limit(limits.maxPulses, t)],
          [t("billing.maxCollaborators"), limit(limits.maxCollaborators, t)],
          [t("billing.maxResources"), limit(limits.maxResourcesPerPulse, t)],
        ].map(([label_, value]) => (
          <div key={label_} className="flex items-baseline justify-between gap-2">
            <dt className="text-[11px]" style={{ color: "#64748B" }}>{label_}</dt>
            <dd className="text-xs font-medium" style={{ color: "#1F2330" }}>{value}</dd>
          </div>
        ))}
      </dl>

      <button
        onClick={onChoose}
        disabled={current || busy || (tier === "starter" && !subscribed)}
        className="hoverable mt-4 rounded-lg px-3 py-2 text-xs font-semibold disabled:cursor-default disabled:opacity-55"
        style={
          current || (tier === "starter" && !subscribed)
            ? { background: "#EEF1F5", color: "#64748B" }
            : { background: tier === "business" ? "#123359" : "#D85A28", color: "#FFFFFF" }
        }
      >
        {busy ? <InlineSpinner /> : label}
      </button>

      {/* TEST BUTTON — forces currency=mxn instead of letting Stripe geolocate,
          so the MXN currency_options entry can be verified end to end. Remove
          once multi-currency is confirmed, or promote it to the "pay in another
          currency" escape hatch. */}
      {onChooseMxn && !current && !subscribed && (
        <button
          onClick={onChooseMxn}
          disabled={busy}
          className="hoverable mt-2 rounded-lg border px-3 py-2 text-xs font-semibold disabled:cursor-default disabled:opacity-55"
          style={{ borderColor: "#D85A28", color: "#D85A28", background: "#FFFFFF" }}
        >
          {busy ? <InlineSpinner /> : t("billing.buyInCurrency", { currency: "MXN" })}
        </button>
      )}
    </div>
  );
}

export function BillingDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const lang = useI18nStore((s) => s.lang);
  const { billing } = useBilling();
  const [busy, setBusy] = useState<PlanTier | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seats, setSeats] = useState(1);
  // Live prices, so what this form advertises is what Checkout charges (PL14).
  const prices = usePlanPrices(lang);

  const now = Date.now();
  const current = tierOf(billing, now);
  const seatCap = editorSeatLimit(billing, now);
  const state = delinquency(billing, now);
  const subscribed = Boolean(billing?.stripeCustomerId);

  // Full navigation rather than a popup — popups get blocked, and Checkout
  // returns the user here anyway.
  const goto = async (get: () => Promise<string>, marker: PlanTier | "portal") => {
    setBusy(marker);
    setError(null);
    try {
      window.location.assign(await get());
    } catch (err) {
      setError((err as Error).message || t("billing.error"));
      setBusy(null);
    }
  };

  const choose = (tier: PlanTier, currency?: string) => {
    // Already paying? Every change — up, down, or cancel — belongs in the portal.
    if (subscribed) return goto(createPortalUrl, "portal");
    if (tier === "starter") return; // the free default; nothing to buy
    return goto(() => createCheckoutUrl(tier, seats, currency), tier);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-6" onClick={onClose}>
      <div
        className="max-h-full w-full max-w-3xl overflow-y-auto rounded-2xl bg-yasdu-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-base font-semibold text-yasdu-fg">{t("account.billing")}</h2>

        <p className="mt-1 text-xs" style={{ color: "#64748B" }}>
          {t("billing.youAreOn", { tier: TIER_LABEL[current] })}
          {billing?.currentPeriodEnd && billing.status === "active" && (
            <> · {t("billing.renews")} {formatDate(billing.currentPeriodEnd, lang)}</>
          )}
          {seatCap !== null && <> · {t("billing.editorSeats")}: {seatCap}</>}
        </p>

        {/* Delinquency — the same state the dashboard banner reads. */}
        {state.isDelinquent && (
          <div className="mt-3 rounded-lg border px-3 py-2 text-[13px]" style={{ background: "#FDECEA", borderColor: "#F3C7C1", color: "#8C2F22" }}>
            {state.expired
              ? t("plan.pastDueExpired", { days: DELINQUENCY_GRACE_DAYS })
              : t("billing.pastDueDetail", { days: state.daysRemaining })}
          </div>
        )}

        {/* Seats are chosen up front only for a first subscription; afterwards
            the quantity is changed in the portal alongside everything else. */}
        {!subscribed && (
          <label className="mt-4 flex items-center gap-3 text-xs" style={{ color: "#64748B" }}>
            {t("billing.seatsToBuy")}
            <input
              type="number"
              min={1}
              max={999}
              value={seats}
              onChange={(e) => setSeats(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
              className="w-20 rounded-lg border px-2 py-1.5 text-sm"
              style={{ borderColor: "#E2DFD9", background: "#FFFFFF", color: "#1F2330", outline: "none" }}
            />
          </label>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {ALL_TIERS.map((tier) => (
            <PlanColumn
              key={tier}
              tier={tier}
              current={tier === current}
              subscribed={subscribed}
              busy={busy === tier || (subscribed && busy === "portal")}
              price={prices[tier].formatted}
              onChoose={() => void choose(tier)}
              onChooseMxn={tier === "starter" ? undefined : () => void choose(tier, "mxn")}
              t={t}
            />
          ))}
        </div>

        {subscribed && (
          <button
            onClick={() => void goto(createPortalUrl, "portal")}
            disabled={busy !== null}
            className="hoverable mt-3 w-full rounded-lg border px-3.5 py-2 text-sm font-semibold disabled:opacity-60"
            style={{ borderColor: "#D85A28", color: "#D85A28" }}
          >
            {busy === "portal" ? <InlineSpinner /> : t("billing.managePayment")}
          </button>
        )}

        {error && <p className="mt-3 text-xs" style={{ color: "#DC2626" }}>{error}</p>}
        <p className="mt-3 text-[11px] leading-relaxed" style={{ color: "#94A3B8" }}>{t("billing.hostedNote")}</p>

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="hoverable rounded-lg border px-3.5 py-2 text-sm" style={{ borderColor: "#E2DFD9", color: "#334155" }}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
