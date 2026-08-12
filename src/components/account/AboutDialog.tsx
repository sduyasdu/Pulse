import { useEffect } from "react";
import { PulseLockup } from "@/components/shared/Logo";
import { useT } from "@/i18n";

/** The copyright holder, and the domicile that goes with it. Not translated and
 * not assembled from parts: a registered company name is a proper noun, and a
 * legal notice that reads differently in six languages is six notices
 * (About-Spec §5, AB9/AB10). */
const LEGAL_ENTITY = "Yasdu Innovación y Servicios SA de CV · México";

const YASDU_URL = "https://yasdu.com";

/**
 * About Pulse — who makes this, and which build you are looking at
 * (`About-Spec.md`). Informational only: no form, no state, nothing to save.
 *
 * The version block reports the git short SHA and build date injected at build
 * time (§4), never package.json's version — that has sat at 0.0.0 since the
 * repo was created, and a version box that answers confidently and wrongly is
 * worse than one that isn't there.
 */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  // Copyright year comes off the build stamp, not the viewer's clock (AB8).
  const year = __APP_BUILT__.slice(0, 4);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        className="w-full max-w-sm rounded-2xl bg-yasdu-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="about-title" className="sr-only">{t("about.title")}</h2>

        <div className="flex flex-col items-center gap-2 text-center">
          <PulseLockup variant="light" size={22} />
          <p className="text-xs" style={{ color: "#64748B" }}>{t("auth.tagline")}</p>
          {/* Selectable on purpose — people paste this into bug reports. */}
          <p className="mono text-[11px]" style={{ color: "#94A3B8" }}>
            {t("about.version", { commit: __APP_COMMIT__, date: __APP_BUILT__ })}
          </p>
        </div>

        <div className="my-5 border-t" style={{ borderColor: "#F1F5F9" }} />

        <div className="flex flex-col items-center gap-3 text-center">
          <a href={YASDU_URL} target="_blank" rel="noopener noreferrer" aria-label={t("about.visitYasdu")} title={t("about.visitYasdu")}>
            {/* The kit ships PNG only (no SVG export), so the intrinsic size is
                declared to keep the layout from shifting as it loads — 427×123
                native against a 96px box, which stays crisp past 3× (AB6). */}
            <img src="/brand/yasdu-lockup-light.png" alt="Yasdu" width={96} height={28} style={{ display: "block" }} />
          </a>
          <p className="text-xs" style={{ color: "#334155" }}>{t("about.aYasduProduct")}</p>
          <p className="text-[11px]" style={{ color: "#94A3B8" }}>
            {t("about.copyright", { year, entity: LEGAL_ENTITY })}
          </p>
        </div>

        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold" style={{ color: "#64748B" }}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
