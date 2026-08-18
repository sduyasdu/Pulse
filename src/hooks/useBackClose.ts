import { useEffect, useRef } from "react";

/**
 * Make the platform Back gesture close an overlay instead of leaving the page.
 *
 * A full-screen "screen" that is really React state — a task editor, a comments
 * panel — is invisible to the browser's history. So Android's back swipe (and a
 * desktop browser's Back button) pops the *route*, and the customer is thrown
 * out of the Pulse to the dashboard with their editor never having been a place
 * they could return from. Nothing in the app is wrong; the app simply never told
 * the browser that a screen had opened.
 *
 * So: push one throwaway history entry while an overlay is open, and treat
 * `popstate` as "close it". Two details make it behave:
 *
 * **One guard for all overlays, keyed on "is anything open".** Not one per
 * overlay. Swapping directly between two — opening a task from the comments
 * list — would otherwise unmount one guard and mount another, and the `back()`
 * from the first arrives *after* the second has pushed, closing the screen the
 * customer just opened. Keeping `active` true across the swap means no push or
 * pop happens at all.
 *
 * **Closing from the UI has to consume the entry too.** Tapping the on-screen
 * back arrow leaves our entry on the stack, and the next real Back press would
 * spend itself on it, appearing to do nothing. So the cleanup pops it — unless
 * `popstate` already did, which is what `consumed` tracks.
 */
export function useBackClose(active: boolean, close: () => void): void {
  // Kept in a ref so a new closure identity on every render cannot re-run the
  // effect — re-running it would push a second entry per render.
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!active) return;
    let consumed = false;

    window.history.pushState({ overlay: true }, "");

    const onPop = () => {
      consumed = true; // the browser has already removed our entry
      closeRef.current();
    };
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      if (!consumed) window.history.back();
    };
  }, [active]);
}
