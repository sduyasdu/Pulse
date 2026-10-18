import { useEffect, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { InlineSpinner } from "@/components/shared/Spinner";
import { useBilling } from "@/hooks/useBilling";
import { usePlanPrices } from "@/hooks/usePlanPrices";
import { MXN, USD, defaultPresentmentCurrency } from "@/domain/presentmentCurrency";
import {
  createCheckoutUrl,
  createPortalUrl,
  endFreeTrial,
  getReferrals,
  getTrialOffer,
  quoteEndFreeTrial,
  type ReferralSummary,
} from "@/services/firestore/billing";
import { formatMinorUnits } from "@/domain/money";
import { cardBrand } from "@/domain/planNotice";
import {
  ALL_TIERS,
  TIER_ENTITLEMENTS,
  delinquency,
  editorSeatLimit,
  graceDaysFor,
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
  trial,
  busy,
  price,
  onChoose,
  t,
}: {
  tier: PlanTier;
  current: boolean;
  subscribed: boolean;
  /** This Upgrade starts the org's free month (TR1) — the button says so. */
  trial: boolean;
  busy: boolean;
  /** Already formatted, and sourced from Stripe where available (PL14) — the
   * column no longer decides what a tier costs. */
  price: string;
  onChoose: () => void;
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
        : trial
          ? t("billing.startFreeMonth")
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

    </div>
  );
}

/**
 * The American Express card-brand mark (`public/brand/Amex_logo_color.svg`).
 *
 * An `<img>` rather than inline SVG: the file carries an Illustrator `<style>`
 * block with a generic `.st0` class, which inlining would leak into the page and
 * let any other `.st0` recolour the logo. As an image it is self-contained.
 *
 * Decorative — the adjacent copy already names American Express — so it is
 * hidden from assistive tech rather than repeating that. The artwork sits in a
 * square canvas with the mark across the middle band, hence a height taller than
 * the visible glyph; explicit dimensions keep the row from reflowing as it
 * loads.
 */
function AmexMark() {
  return (
    <img
      src="/brand/Amex_logo_color.svg"
      alt=""
      aria-hidden
      width={34}
      height={34}
      style={{ flexShrink: 0, display: "block" }}
    />
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
  // Which currency this form is quoting in. Seeded from the browser's timezone
  // (Mexico → pesos), then whatever the customer picks. It is passed straight
  // to Checkout, so the quote is a promise rather than a guess (PL17).
  const [currency, setCurrency] = useState(defaultPresentmentCurrency);
  const canOfferMxn = prices.has("pro", MXN) && prices.has("business", MXN);
  // The Amex escape hatch is only meaningful for someone being quoted in USD:
  // a customer already in pesos has no Amex problem to solve.
  const showAmexSwitch = currency === USD && canOfferMxn;
  const inMxnForAmex = currency === MXN && defaultPresentmentCurrency() !== MXN;

  const now = Date.now();
  const current = tierOf(billing, now);
  const seatCap = editorSeatLimit(billing, now);
  const state = delinquency(billing, now);
  const subscribed = Boolean(billing?.stripeCustomerId);
  const trialing = billing?.status === "trialing";
  const card = billing?.card ? `${cardBrand(billing.card.brand)} ···· ${billing.card.last4}` : null;

  // TR1: whether Upgrade starts a free month is the SERVER's reading — the person and
  // card marks are not readable here. Asked only by someone who has never subscribed;
  // a refusal (a non-owner) leaves the ordinary buttons.
  const [offer, setOffer] = useState<{ days: number; maxSeats: number } | null>(null);
  useEffect(() => {
    if (subscribed) return;
    let live = true;
    getTrialOffer()
      .then((o) => {
        if (!live || !o.offered) return;
        setOffer({ days: o.days, maxSeats: o.maxSeats });
        setSeats((n) => Math.min(n, o.maxSeats)); // TR2: a free month starts with at most 5
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [subscribed]);
  const maxSeats = offer ? offer.maxSeats : 999;

  // TR2: seats are not added during the free month — End the free trial first, after
  // seeing the first invoice and the card it goes to.
  const [quote, setQuote] = useState<{ amount: string; card: string | null } | null>(null);
  const [ending, setEnding] = useState<"quote" | "end" | null>(null);
  const askQuote = async () => {
    setEnding("quote");
    setError(null);
    try {
      const q = await quoteEndFreeTrial();
      setQuote({ amount: formatMinorUnits(q.amount, q.currency, lang), card: q.card ? `${cardBrand(q.card.brand)} ···· ${q.card.last4}` : card });
    } catch (err) {
      setError((err as Error).message || t("billing.error"));
    } finally {
      setEnding(null);
    }
  };
  const confirmEnd = async () => {
    setEnding("end");
    setError(null);
    try {
      await endFreeTrial();
      setQuote(null); // the webhook moves the plan to active; this dialog follows it live
    } catch (err) {
      setError((err as Error).message || t("billing.error"));
    } finally {
      setEnding(null);
    }
  };

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

  const choose = (tier: PlanTier) => {
    // Already paying? Every change — up, down, or cancel — belongs in the portal.
    if (subscribed) return goto(createPortalUrl, "portal");
    if (tier === "starter") return; // the free default; nothing to buy
    // The currency on screen is the currency billed — never let Stripe
    // re-geolocate and quote something the customer wasn't shown (PL17).
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
          {trialing && billing?.trialEnd && (
            <>
              {" · "}
              {billing.nextAmount != null && billing.currency && card
                ? t("billing.trialLine", {
                    date: formatDate(billing.trialEnd, lang),
                    amount: formatMinorUnits(billing.nextAmount, billing.currency, lang),
                    card,
                  })
                : t("billing.trialLineShort", { date: formatDate(billing.trialEnd, lang) })}
            </>
          )}
          {billing?.currentPeriodEnd && billing.status === "active" && (
            <> · {t("billing.renews")} {formatDate(billing.currentPeriodEnd, lang)}</>
          )}
          {seatCap !== null && <> · {t("billing.editorSeats")}: {seatCap}</>}
        </p>

        {/* Delinquency — the same state the dashboard banner reads. */}
        {state.isDelinquent && (
          <div className="mt-3 rounded-lg border px-3 py-2 text-[13px]" style={{ background: "#FDECEA", borderColor: "#F3C7C1", color: "#8C2F22" }}>
            {state.expired
              ? t("plan.pastDueExpired", { days: graceDaysFor(billing) })
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
              max={maxSeats}
              value={seats}
              onChange={(e) => setSeats(Math.max(1, Math.min(maxSeats, Number(e.target.value) || 1)))}
              className="w-20 rounded-lg border px-2 py-1.5 text-sm"
              style={{ borderColor: "#E2DFD9", background: "#FFFFFF", color: "#1F2330", outline: "none" }}
            />
          </label>
        )}
        {!subscribed && offer && (
          <p className="mt-2 text-xs" style={{ color: "#64748B" }}>
            {t("billing.trialNote", { days: offer.days, max: offer.maxSeats })}
          </p>
        )}

        {/* TR2: during the free month the seat count is fixed. */}
        {trialing && (
          <div className="mt-3 rounded-lg border px-3 py-2.5 text-xs" style={{ borderColor: "#E2DFD9", color: "#334155" }}>
            <p>{t("billing.trialNoSeats")}</p>
            {quote ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="flex-1" style={{ minWidth: 200 }}>
                  {quote.card ? t("billing.endTrialQuote", { amount: quote.amount, card: quote.card }) : t("billing.endTrialQuoteNoCard", { amount: quote.amount })}
                </span>
                <button onClick={() => setQuote(null)} className="hoverable rounded-lg border px-3 py-1.5" style={{ borderColor: "#E2DFD9" }}>
                  {t("common.cancel")}
                </button>
                <button
                  onClick={() => void confirmEnd()}
                  disabled={ending !== null}
                  className="hoverable rounded-lg px-3 py-1.5 font-semibold disabled:opacity-60"
                  style={{ background: "#D85A28", color: "#FFFFFF" }}
                >
                  {ending === "end" ? <InlineSpinner /> : t("billing.endTrialConfirm")}
                </button>
              </div>
            ) : (
              <button
                onClick={() => void askQuote()}
                disabled={ending !== null}
                className="hoverable mt-2 rounded-lg border px-3 py-1.5 font-semibold disabled:opacity-60"
                style={{ borderColor: "#D85A28", color: "#D85A28" }}
              >
                {ending === "quote" ? <InlineSpinner /> : t("billing.endTrialToAddSeats")}
              </button>
            )}
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {ALL_TIERS.map((tier) => (
            <PlanColumn
              key={tier}
              tier={tier}
              current={tier === current}
              subscribed={subscribed}
              trial={offer !== null}
              busy={busy === tier || (subscribed && busy === "portal")}
              price={prices.priceOf(tier, currency).formatted}
              onChoose={() => void choose(tier)}
              t={t}
            />
          ))}
        </div>

        {/* Currency, under the plans it applies to. Not a question every
            customer answers — the form opens in the right one for where they
            appear to be, and this is only the Amex escape hatch (PL17). */}
        {!subscribed && showAmexSwitch && (
          <button
            onClick={() => setCurrency(MXN)}
            className="hoverable mt-3 flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-semibold"
            style={{ borderColor: "#CBD5E1", background: "#FFFFFF", color: "#1B3A63" }}
          >
            <AmexMark />
            <span>{t("billing.amexSwitch")}</span>
            <Icon name="chevron_right" size={16} style={{ marginLeft: "auto", color: "#94A3B8" }} />
          </button>
        )}
        {!subscribed && inMxnForAmex && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2.5 text-xs" style={{ background: "#FFF7F1", border: "1px solid #FBD3BE", color: "#9A3412" }}>
            <AmexMark />
            <span className="flex-1" style={{ minWidth: 180 }}>{t("billing.amexNotice")}</span>
            <button onClick={() => setCurrency(USD)} className="underline" style={{ color: "#9A3412" }}>
              {t("billing.backToUsd")}
            </button>
          </div>
        )}

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

        <InviteAndEarn currency={billing?.currency ?? currency} lang={lang} t={t} />
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

/**
 * Invite and earn (Trials-and-Referrals-Spec TR8, TR12–TR14): the workspace's link,
 * what a friend is worth, and the counts. Owner-only, like everything here — the
 * callable refuses anyone else, and then this section is simply absent.
 */
function InviteAndEarn({ currency, lang, t }: { currency: string; lang: string; t: TFn }) {
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [making, setMaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getReferrals(false, currency)
      .then((s) => live && setSummary(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [currency]);

  if (!summary) return null;
  const link = summary.code ? `${window.location.origin}/r/${summary.code}` : null;
  const reward = summary.reward != null ? formatMinorUnits(summary.reward, summary.currency, lang) : null;

  const make = async () => {
    setMaking(true);
    setFailed(false);
    try {
      setSummary(await getReferrals(true, currency));
    } catch {
      setFailed(true);
    } finally {
      setMaking(false);
    }
  };
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
    }
  };

  const stats: [string, number][] = [
    [t("billing.referralSignedUp"), summary.signedUp],
    [t("billing.referralSubscribed"), summary.subscribed],
    [t("billing.referralEarned", { cap: summary.cap }), summary.earnedThisYear],
    [t("billing.referralWaiting"), summary.banked],
  ];

  return (
    <section className="mt-5 rounded-xl border p-4" style={{ borderColor: "#E2DFD9", background: "#FFFFFF" }}>
      <div className="flex items-center gap-2">
        <Icon name="redeem" size={18} style={{ color: "#D85A28" }} />
        <h3 className="font-display text-sm font-semibold" style={{ color: "#1F2330" }}>{t("billing.inviteAndEarn")}</h3>
      </div>
      <p className="mt-1 text-xs" style={{ color: "#64748B" }}>
        {reward ? t("billing.referralRule", { amount: reward }) : t("billing.referralRuleNoAmount")}
      </p>

      {link ? (
        <div className="mt-3 flex items-center gap-2">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="mono min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-xs"
            style={{ borderColor: "#E2DFD9", background: "#FAFAF7", color: "#1F2330", outline: "none" }}
            aria-label={t("billing.referralLink")}
          />
          <button
            onClick={() => void copy()}
            className="hoverable flex flex-shrink-0 items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold"
            style={{ borderColor: "#D85A28", color: "#D85A28" }}
          >
            <Icon name={copied ? "check" : "content_copy"} size={14} />
            {copied ? t("billing.copied") : t("billing.copyLink")}
          </button>
        </div>
      ) : (
        <button
          onClick={() => void make()}
          disabled={making}
          className="hoverable mt-3 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
          style={{ borderColor: "#D85A28", color: "#D85A28" }}
        >
          {making ? <InlineSpinner /> : t("billing.getReferralLink")}
        </button>
      )}
      {failed && <p className="mt-2 text-xs" style={{ color: "#DC2626" }}>{t("billing.error")}</p>}

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map(([label, n]) => (
          <div key={label} className="flex flex-col-reverse rounded-lg px-2.5 py-2" style={{ background: "#F7F6F2" }}>
            <dt className="text-[11px] leading-tight" style={{ color: "#64748B" }}>{label}</dt>
            <dd className="font-display text-base font-semibold" style={{ color: "#1F2330" }}>{n}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
