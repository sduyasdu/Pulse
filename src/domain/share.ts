// Sharing a link: the platform's own share sheet where there is one, the
// clipboard everywhere else.
//
// navigator.share() is the Web Share API. On a phone (iOS Safari, Android
// Chrome) it opens the native share sheet — the same sheet a native app's
// share intent opens — so a link goes straight to WhatsApp, Mail, Slack or
// AirDrop. On the desktop web it exists in Safari on macOS and in Chrome/Edge
// on Windows, and is simply absent in Chrome and Firefox on macOS and Linux.
//
// Two constraints shape the API below:
//   * it needs a secure context (HTTPS — localhost counts), and
//   * it needs a live user gesture, so it must be called from the click
//     handler itself. An `await` on a network round-trip before the call can
//     outlive the gesture on Safari and get the share rejected.
//
// Callers therefore don't branch on capability: shareOrCopy() shares when it
// can, copies when it can't, and reports which happened so the UI can say the
// right thing.

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

export interface SharePayload {
  title?: string;
  text?: string;
  url: string;
}

/** Whether this browser can open a share sheet (for `payload`, if given). Use
 * it to label a button, not to decide whether to call shareOrCopy(). */
export function canNativeShare(payload?: SharePayload): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  if (payload && typeof navigator.canShare === "function") return navigator.canShare(payload);
  return true;
}

/** Clipboard write with a fallback for contexts that refuse the async API
 * (Safari private browsing, some embedded webviews). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      // Off-screen but still selectable; `position: fixed` keeps the page from
      // scrolling to it on iOS.
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Open the share sheet, or fall back to copying the URL. */
export async function shareOrCopy(payload: SharePayload): Promise<ShareOutcome> {
  if (canNativeShare(payload)) {
    try {
      await navigator.share(payload);
      return "shared";
    } catch (err) {
      // Dismissing the sheet throws AbortError. That is a decision, not a
      // failure: falling through to the clipboard would hand the user a copied
      // link they had just declined to share.
      if ((err as { name?: string } | null)?.name === "AbortError") return "cancelled";
      // Anything else (no share target, a permissions policy, a lost gesture)
      // still deserves to leave the user holding the link.
    }
  }
  return (await copyText(payload.url)) ? "copied" : "failed";
}
