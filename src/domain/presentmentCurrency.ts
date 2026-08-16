/** Currencies the plans form can present (Plans-Spec PL17). */
export const USD = "usd";
export const MXN = "mxn";

/**
 * IANA zones for Mexico. Used to guess whether to open the plans form in pesos.
 *
 * A timezone is a **heuristic**, not a location: a VPN, a traveller, or a laptop
 * left on the wrong zone will all read wrong. That is acceptable here because it
 * only chooses the *default*, and the choice is never silent — the form shows
 * the currency it will charge and offers the other one, so a wrong guess is
 * visible and one click from corrected.
 *
 * Deliberately not an IP lookup: that means a third-party request on the billing
 * screen, a dependency, and a privacy question, to improve a default that is
 * already correctable.
 */
const MX_TIMEZONES = new Set([
  "America/Mexico_City",
  "America/Cancun",
  "America/Merida",
  "America/Monterrey",
  "America/Matamoros",
  "America/Chihuahua",
  "America/Ciudad_Juarez",
  "America/Ojinaga",
  "America/Mazatlan",
  "America/Bahia_Banderas",
  "America/Hermosillo",
  "America/Tijuana",
]);

/** True when this browser looks like it is in Mexico. */
export function looksMexican(): boolean {
  try {
    return MX_TIMEZONES.has(Intl.DateTimeFormat().resolvedOptions().timeZone ?? "");
  } catch {
    return false; // no Intl, or a locked-down environment — fall back to USD
  }
}

/** Which currency the plans form should open in. */
export function defaultPresentmentCurrency(): string {
  return looksMexican() ? MXN : USD;
}
