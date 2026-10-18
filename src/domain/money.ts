/** Stripe stores minor units (600 = $6.00), except in zero-decimal currencies
 * where 600 means 600. Intl knows which is which per currency, so dividing by
 * 100 unconditionally would be wrong for JPY and friends — ask Intl instead.
 * Here rather than in `usePlanPrices` so pure domain code (`planNotice`) can
 * format money without importing a React hook's module. */
export function formatMinorUnits(minor: number, currency: string, lang: string): string {
  const fmt = new Intl.NumberFormat(lang, { style: "currency", currency: currency.toUpperCase() });
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  return fmt.format(minor / 10 ** digits);
}
