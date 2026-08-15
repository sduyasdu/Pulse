import { describe, expect, it } from "vitest";
import { formatMinorUnits } from "./usePlanPrices";

/** Intl separates the amount from the symbol with a NON-BREAKING space (U+00A0),
 * or a narrow one (U+202F) in some locales — indistinguishable on screen from a
 * plain space, and not equal to it. Normalise so these assertions test the
 * formatting rather than the invisible character. */
const norm = (s: string) => s.replace(/[  ]/g, " ");

/** This renders money on the screen immediately before payment, and the
 * minor-unit convention is the kind of thing that is silently wrong by 100x. */
describe("formatMinorUnits", () => {
  it("renders two-decimal currencies from minor units", () => {
    expect(norm(formatMinorUnits(600, "usd", "en"))).toBe("$6.00");
    expect(norm(formatMinorUnits(12000, "mxn", "en"))).toBe("MX$120.00");
  });

  // The reason this doesn't just divide by 100: in a zero-decimal currency the
  // stored integer IS the amount, so /100 would show 100x less than is charged.
  it("leaves zero-decimal currencies undivided", () => {
    expect(norm(formatMinorUnits(600, "jpy", "en"))).toBe("¥600");
  });

  it("formats in the app's active language, not the browser's", () => {
    expect(norm(formatMinorUnits(600, "eur", "de"))).toBe("6,00 €");
    expect(norm(formatMinorUnits(12000, "mxn", "es"))).toBe("120,00 MXN");
  });

  it("accepts a lowercase currency code, as Stripe returns it", () => {
    expect(formatMinorUnits(600, "usd", "en")).toBe(formatMinorUnits(600, "USD", "en"));
  });
});
