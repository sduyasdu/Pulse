import { useEffect, useState } from "react";

// Phones get the dedicated mobile Pulse experience; the dense canvas layout is
// desktop/tablet only. Narrow width catches portrait phones; short height
// catches phones in LANDSCAPE (wider than the width breakpoint but far too
// short for the desktop toolbar + canvas + bottom panel to fit). Tablets in
// either orientation clear both thresholds and keep the canvas. Kept as a
// media query so it tracks orientation changes and resizing live.
const MOBILE_QUERY = "(max-width: 767px), (max-height: 480px)";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(MOBILE_QUERY).matches : false,
  );
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    setIsMobile(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

/** True on touch devices (iPad, phones) — used to make touch targets bigger. */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(pointer: coarse)").matches : false,
  );
  useEffect(() => {
    const mql = window.matchMedia("(pointer: coarse)");
    const onChange = () => setCoarse(mql.matches);
    mql.addEventListener("change", onChange);
    setCoarse(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return coarse;
}
