import { BeatsLockup } from "@/components/shared/Logo";
import { CanvasPreview } from "@/components/auth/CanvasPreview";
import { useT } from "@/i18n";
import type { TranslationKey } from "@/i18n";

/**
 * The pitch beside the sign-in card.
 *
 * The sign-in page is the only page a prospective customer reliably sees before
 * deciding, and it said nothing about the product beyond a one-line tagline.
 * This carries the same argument the marketing page at yasdu.com/pulse makes,
 * in the same order — the canvas, height-as-effort, capacity — so someone
 * arriving from a shared invite link learns what they are joining.
 *
 * Deliberately NOT a second marketing site: no pricing, no feature inventory,
 * no navigation away. Three points, one picture, and the reassurances that
 * matter at the moment of signing up.
 */

const POINTS: { title: TranslationKey; body: TranslationKey }[] = [
  { title: "auth.pointCanvasTitle", body: "auth.pointCanvasBody" },
  { title: "auth.pointHeightTitle", body: "auth.pointHeightBody" },
  { title: "auth.pointPeopleTitle", body: "auth.pointPeopleBody" },
];

export function LoginHero({ className }: { className?: string }) {
  const t = useT();

  return (
    <div className={className}>
      {/* Hidden on small screens: the card above already carries the lockup and
          the tagline, and repeating them would push the pitch further from the
          form someone came here to use. */}
      <div className="mb-5 hidden lg:block">
        <BeatsLockup variant="light" size={26} />
      </div>

      <h2
        className="font-display text-2xl font-bold leading-tight sm:text-3xl lg:text-[2.6rem]"
        style={{ color: "#123359", letterSpacing: "-0.02em" }}
      >
        {t("auth.heroTitle")}
      </h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-yasdu-muted sm:text-base">{t("auth.heroLead")}</p>

      <div className="mt-6 overflow-hidden rounded-xl border shadow-sm" style={{ borderColor: "#E2DFD9" }}>
        <CanvasPreview />
      </div>

      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        {POINTS.map((p) => (
          <div
            key={p.title}
            className="rounded-xl border p-3.5"
            style={{ borderColor: "#E2DFD9", background: "#FFFFFF" }}
          >
            <dt className="font-display text-sm font-semibold" style={{ color: "#123359" }}>
              {t(p.title)}
            </dt>
            <dd className="mt-1 text-xs leading-relaxed text-yasdu-muted">{t(p.body)}</dd>
          </div>
        ))}
      </dl>

      {/* The line the whole product turns on, given the weight it deserves. */}
      <p
        className="font-display mt-6 border-l-2 pl-3 text-sm font-medium sm:text-base"
        style={{ borderColor: "#EE7240", color: "#123359" }}
      >
        {t("auth.punchline")}
      </p>
    </div>
  );
}
