import { useEffect } from "react";
import { useConfirmStore } from "@/stores/confirmStore";

const W = 264;
const EST_H = 132;

/** Renders the app-wide confirmation popover next to the triggering click.
 * Mounted once at the app root; driven by confirmStore. */
export function ConfirmPopover() {
  const request = useConfirmStore((s) => s.request);
  const close = useConfirmStore((s) => s.close);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      else if (e.key === "Enter") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, close]);

  if (!request) return null;

  // Anchor near the click, but keep the whole card on-screen.
  const left = Math.max(12, Math.min(request.x, window.innerWidth - W - 12));
  const top = Math.max(12, Math.min(request.y, window.innerHeight - EST_H - 12));

  return (
    <div className="fixed inset-0" style={{ zIndex: 300 }} onClick={() => close(false)} onContextMenu={(e) => e.preventDefault()}>
      <div
        role="alertdialog"
        onClick={(e) => e.stopPropagation()}
        className="fixed rounded-xl"
        style={{ left, top, width: W, background: "#FFFFFF", border: "1px solid #E2DFD9", boxShadow: "0 12px 32px rgba(15,23,42,0.22)", padding: 14 }}
      >
        <div className="text-sm font-semibold" style={{ color: "#1F2330" }}>{request.message}</div>
        {request.detail && <div className="mt-1 text-xs leading-relaxed" style={{ color: "#64748B" }}>{request.detail}</div>}
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={() => close(false)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors hover:brightness-95"
            style={{ background: "#F1F5F9", color: "#475569" }}
          >
            Cancel
          </button>
          <button
            autoFocus
            onClick={() => close(true)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors hover:brightness-110"
            style={{ background: "#E5484D", color: "#FFFFFF" }}
          >
            {request.confirmLabel || "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
