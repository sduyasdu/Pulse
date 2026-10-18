// The referral code a visitor arrived with (Trials-and-Referrals-Spec TR9). Kept in
// the browser for 60 days from `/r/{code}`, so someone who looks today and signs up
// next week is still counted; claimed once after sign-in, then forgotten. Pure but for
// the storage it is handed, so the expiry is testable.

export const REFERRAL_KEY = "beats.referral";
export const REFERRAL_DAYS = 60;
const CODE_RE = /^[a-z2-9]{8}$/;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function store(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null; // privacy modes throw; a lost code costs a referral, nothing else
  }
}

/** Keep a code from a link. A malformed one is not kept. */
export function keepReferral(code: string, now = Date.now(), s: Store | null = store()): boolean {
  const c = code.trim().toLowerCase();
  if (!CODE_RE.test(c) || !s) return false;
  try {
    s.setItem(REFERRAL_KEY, JSON.stringify({ code: c, at: now }));
    return true;
  } catch {
    return false;
  }
}

/** The kept code, or null when there is none or it is older than 60 days. */
export function keptReferral(now = Date.now(), s: Store | null = store()): string | null {
  if (!s) return null;
  try {
    const raw = s.getItem(REFERRAL_KEY);
    if (!raw) return null;
    const { code, at } = JSON.parse(raw) as { code?: unknown; at?: unknown };
    if (typeof code !== "string" || !CODE_RE.test(code) || typeof at !== "number") return null;
    if (now - at > REFERRAL_DAYS * 24 * 60 * 60 * 1000) {
      s.removeItem(REFERRAL_KEY);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

export function forgetReferral(s: Store | null = store()): void {
  try {
    s?.removeItem(REFERRAL_KEY);
  } catch {
    /* nothing to do */
  }
}
