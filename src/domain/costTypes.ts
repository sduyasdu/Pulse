// The cost-type registry — Costs-Spec §2 (CO1: code, not user data; these
// carry logic, not just labels). "ai" is the only type built; the reserved
// "resource" (human hours) type is spec §8, deliberately absent here.
import type { CostTypeDef, CostTypeId } from "@/types";

/** AI vendors offered as an enum so the view can group and colour them
 * consistently. `other` + the free-text model keeps it open-ended. */
export const AI_BRANDS = ["anthropic", "openai", "google", "meta", "mistral", "xai", "deepseek", "other"] as const;

/**
 * AI cost type. One `tokens` measure, not an input/output split (CO2): AI
 * entries are amount-based (CO4), so the mix never has to reconstruct the
 * money — the derived unit cost is a blended $/Mtok.
 */
export const AI_COST_TYPE: CostTypeDef = {
  id: "ai",
  label: "cost.type.ai",
  measures: [{ id: "tokens", label: "cost.measure.tokens", unit: "cost.unit.tokens", priceScale: 1_000_000 }],
  attributes: [
    { id: "brand", label: "cost.attr.brand", kind: "enum", options: [...AI_BRANDS], required: true },
    { id: "model", label: "cost.attr.model", kind: "text", required: true },
    // The human who used the AI. Optional: unattributed spend is still valid.
    { id: "resourceId", label: "cost.attr.resource", kind: "resourceRef" },
  ],
  defaultBasis: "amount",
  groupBy: ["model", "resourceId"],
  color: "#8B5CF6", // matches the ✨/bolt AI marker already used on task boxes
};

/**
 * People cost — Costs-Spec §8. The `"rate"` half of the basis model: hours × $/h.
 * Entries of this type are never stored (CO13); they're derived from assignments by
 * `peopleCostRows`, and the rate comes from the admin-only `rates/{resourceId}`
 * document rather than from the Resource itself (§8.3).
 */
export const PEOPLE_COST_TYPE: CostTypeDef = {
  id: "people",
  label: "cost.type.people",
  measures: [{ id: "hours", label: "cost.measure.hours", unit: "cost.unit.hours", priceScale: 1 }],
  attributes: [{ id: "resourceId", label: "cost.attr.person", kind: "resourceRef", required: true, inheritFrom: "hourlyRate" }],
  defaultBasis: "rate",
  groupBy: ["resourceId", "featureId"], // person › task
  color: "#0E7490", // teal — distinct from AI's violet
};

export const COST_TYPES: CostTypeDef[] = [AI_COST_TYPE, PEOPLE_COST_TYPE];

/** Working hours in a day when a Pulse hasn't set its own (Costs-Spec CO16). */
export const DEFAULT_HOURS_PER_DAY = 8;

export function costTypeById(id: CostTypeId): CostTypeDef | null {
  return COST_TYPES.find((t) => t.id === id) ?? null;
}

/** Every model already used in this Pulse, for the entry form's suggestions —
 * the closest thing to a catalog we keep, given there's no price table (CO4). */
export function modelsUsed(entries: { typeId: string; attrs: Record<string, string | null> }[]): string[] {
  const seen = new Set<string>();
  entries.forEach((e) => {
    const m = e.attrs?.model;
    if (m) seen.add(m);
  });
  return Array.from(seen).sort();
}
