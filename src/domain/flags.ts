/**
 * Product flags — features that are built and deliberately not shown.
 *
 * Not a config system and not per-customer: a constant, so switching one on or
 * off is a one-line diff with a build behind it, and so every surface it gates
 * flips at the same moment. The alternative — commenting things out where they
 * are mounted — is how one panel gets left behind and a "hidden" feature turns
 * out to be half visible.
 */

/**
 * The costing surface: the cost view in the bottom panel, cost entries on a
 * task, the hourly-rate editor, and the MCP `get_costs` tool
 * (`Costs-Spec.md` §21, CO21).
 *
 * **Hidden, not removed.** The whole costing model is being rethought, and
 * shipping a half-trusted one meanwhile is worse than showing none. No data is
 * touched: `pulses/{id}/costs` and `pulses/{id}/rates` keep every document and
 * `firestore.rules` is unchanged, so what customers recorded is still there and
 * still protected.
 *
 * The components stay in the tree on purpose — a rewrite wants a working
 * reference for the awkward parts (micros arithmetic, the `viewPeopleCost`
 * gate, the cost-type model) far more than it wants a blank page.
 *
 * The MCP tool is gated separately in `functions/src/mcpServer.ts`, because
 * functions cannot import from the app. **The two must be flipped together** —
 * hiding costs from the UI while an assistant reads them aloud is not hiding
 * them.
 */
export const COSTS_ENABLED = false;
