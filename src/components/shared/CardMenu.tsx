import { useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { useT } from "@/i18n";

/**
 * The "⋯" actions menu a card carries in its corner.
 *
 * Extracted from `PulseCard`, which had it hand-rolled, because this is the
 * third card that wants one and three copies of a popover is three chances to
 * get the click-catcher, the z-index or the closing behaviour subtly different.
 *
 * Two details that are easy to lose in a re-implementation and are the reason
 * this is shared:
 *
 * - **The full-screen catcher behind the panel.** Without it the menu only
 *   closes by picking something, which strands a reader who opened it to look.
 * - **`stop` on every handler.** These cards are often inside a `<Link>`, so an
 *   un-stopped click navigates away instead of opening the menu.
 */
export function CardMenu({ items, label }: { items: CardMenuItem[]; label?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const visible = items.filter((i) => !i.hidden);
  if (visible.length === 0) return null;

  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };

  return (
    <div className="relative">
      <button
        onClick={(e) => { stop(e); setOpen((o) => !o); }}
        className="flex items-center justify-center rounded"
        style={{ width: 26, height: 26, background: "#F1EFE8", color: "#64748B", lineHeight: 1, border: "1px solid #E2DFD9" }}
        title={label ?? t("card.moreActions")}
        aria-label={label ?? t("card.moreActions")}
        aria-expanded={open}
      >
        <Icon name="more_horiz" size={18} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 20 }} onClick={(e) => { stop(e); setOpen(false); }} />
          {/* Opens upward: these sit at the bottom of a card, and downward would
              clip against the card's own edge. */}
          <div
            className="absolute right-0 mb-1 rounded-lg border py-1"
            style={{ bottom: "100%", zIndex: 30, minWidth: 168, background: "#FFFFFF", borderColor: "#E2DFD9", boxShadow: "0 8px 24px rgba(15,23,42,0.14)" }}
          >
            {visible.map((item) => (
              <button
                key={item.label}
                onClick={(e) => { stop(e); setOpen(false); item.onClick(e); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-yasdu-secondary"
                style={{ color: item.danger ? "#DC2626" : "#334155" }}
              >
                <Icon name={item.icon} size={15} style={{ color: item.danger ? "#DC2626" : "#64748B" }} />
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export interface CardMenuItem {
  label: string;
  icon: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
  /** Declared and hidden rather than omitted by the caller, so a menu that ends
   * up empty renders nothing at all instead of an button that opens onto air. */
  hidden?: boolean;
}
