import { useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { useBilling } from "@/hooks/useBilling";
import { createCheckoutUrl, createPortalUrl } from "@/services/firestore/billing";
import { entitlementsFor, tierOf, editorSeatLimit, delinquency, DELINQUENCY_GRACE_DAYS } from "@/domain/entitlements";
import { useT, type TFn } from "@/i18n";
import { useI18nStore } from "@/stores/i18nStore";
import type { PlanTier } from "@/types";

/**
 * "Billing & payment" — the org's current plan, what it allows, and the way out
 * to Stripe's hosted flows (Plans-Spec §6). Read-only by construction: the plan
 * doc is server-authoritative (SF3 is its only writer), so every mutation here
 * is a redirect to Stripe and the change lands back via the webhook.
 *
 * Owner-only in practice — `billing/{orgId}` is readable only by the workspace
 * owner, so anyone else sees the free-tier view of their own org.
 */

const PAID_TIERS: Exclude<PlanTier, "pro">[] = ["teams", "business"];

/** `null` = unlimited (Plans-Spec §3). */
const limit = (n: number | null, t: TFn) => (n === null ? t("billing.unlimited") : String(n));

/** Formatted in the app's active language, not the browser's — the user may
 * have overridden it in the account menu. */
function formatDate(ms: number | undefined, lang: string): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric" });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs" style={{ color: "#64748B" }}>{label}</span>
      <span className="text-sm font-medium" style={{ color: "#1F2330" }}>{value}</span>
    </div>
  );
}

export function BillingDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const lang = useI18nStore((s) => s.lang);
  const { billing } = useBilling();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seats, setSeats] = useState(1);

  const now = Date.now();
  const tier = tierOf(billing, now);
  const limits = entitlementsFor(billing, now);
  const seatCap = editorSeatLimit(billing, now);
  const state = delinquency(billing, now);
  const subscribed = Boolean(billing?.stripeCustomerId);

  // Redirect to a Stripe-hosted page. Deliberately a full navigation rather than
  // a popup — popups are blocked more often, and Checkout brings the user back.
  const go = async (kind: "checkout" | "portal", chosen?: Exclude<PlanTier, "pro">) => {
    setBusy(kind);
    setError(null);
    try {
      const url = kind === "portal" ? await createPortalUrl() : await createCheckoutUrl(chosen!, seats);
      window.location.assign(url);
    } catch (err) {
      setError((err as Error).message || t("billing.error"));
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-yasdu-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display mb-4 text-base font-semibold text-yasdu-fg">{t("account.billing")}</h2>

        {/* Current plan */}
        <div className="rounded-xl border p-4" style={{ borderColor: "#E2DFD9", background: "#FAFAF8" }}>
          <div className="mb-1 flex items-center gap-2">
            <Icon name="credit_card" size={16} style={{ color: "#64748B" }} />
            <span className="font-display text-sm font-semibold" style={{ color: "#1F2330" }}>
              {tier.charAt(0).toUpperCase() + tier.slice(1)}
            </span>
            {tier === "pro" && (
              <span className="mono rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide" style={{ background: "#EEF1F5", color: "#94A3B8" }}>
                {t("billing.free")}
              </span>
            )}
          </div>
          <Row label={t("billing.editorSeats")} value={seatCap === null ? t("billing.unlimited") : String(seatCap)} />
          <Row label={t("billing.maxPulses")} value={limit(limits.maxPulses, t)} />
          <Row label={t("billing.maxCollaborators")} value={limit(limits.maxCollaborators, t)} />
          <Row label={t("billing.maxResources")} value={limit(limits.maxResourcesPerPulse, t)} />
          {billing?.currentPeriodEnd && billing.status === "active" && (
            <Row label={t("billing.renews")} value={formatDate(billing.currentPeriodEnd, lang)} />
          )}
        </div>

        {/* Delinquency — the same state the dashboard banner reads. */}
        {state.isDelinquent && (
          <div className="mt-3 rounded-lg border px-3 py-2 text-[13px]" style={{ background: "#FDECEA", borderColor: "#F3C7C1", color: "#8C2F22" }}>
            {state.expired
              ? t("plan.pastDueExpired", { days: DELINQUENCY_GRACE_DAYS })
              : t("billing.pastDueDetail", { days: state.daysRemaining })}
          </div>
        )}

        {/* Actions. An existing subscriber manages everything in the portal —
            card, seat count, cancellation — so we don't rebuild any of it. */}
        <div className="mt-4 flex flex-col gap-2">
          {subscribed ? (
            <button
              onClick={() => void go("portal")}
              disabled={busy !== null}
              className="hoverable rounded-lg px-3.5 py-2 text-sm font-semibold text-yasdu-primary-fg disabled:opacity-60"
              style={{ background: "#D85A28" }}
            >
              {busy === "portal" ? t("common.loading") : t("billing.managePayment")}
            </button>
          ) : (
            <>
              <label className="flex items-center justify-between gap-3 text-xs" style={{ color: "#64748B" }}>
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
              {PAID_TIERS.map((paid) => (
                <button
                  key={paid}
                  onClick={() => void go("checkout", paid)}
                  disabled={busy !== null}
                  className="hoverable rounded-lg px-3.5 py-2 text-sm font-semibold text-yasdu-primary-fg disabled:opacity-60"
                  style={{ background: paid === "teams" ? "#D85A28" : "#123359" }}
                >
                  {busy === "checkout" ? t("common.loading") : t("billing.upgradeTo", { tier: paid === "teams" ? "Teams" : "Business" })}
                </button>
              ))}
            </>
          )}
        </div>

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
