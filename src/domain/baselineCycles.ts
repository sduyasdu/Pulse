import { DEFAULT_STATUSES, DONE_STATUS_ID } from "./constants";
import type { Cycle, StatusDef, StatusQualification } from "@/types";

/**
 * The cycle templates a workspace is given (Cycles-Spec CY12).
 *
 * **`since` is the mechanism, not decoration.** Templates are seeded once and
 * then belong to the org, which is free to edit or delete them. So "have we
 * offered this one yet?" cannot be answered by looking at what is there —
 * absent means either *new* or *deleted*, and re-adding a deleted template on
 * every dashboard load is the obvious implementation and the wrong one. Each
 * template records the seed version it first shipped in, the workspace records
 * the highest version it has been offered, and only the gap is ever written.
 */
export interface BaselineCycle extends Cycle {
  since: number;
}

/** Bump when templates are added below, and give them this `since`. */
export const CURRENT_SEED_VERSION = 2;

/** Four working stages, a stalled one, then Done. */
function stages(steps: [string, string][], hold: string): StatusDef[] {
  return [
    ...steps.map(([id, label], i) => ({
      id,
      label,
      color: i === 0 ? "#64748B" : ["#F5A524", "#6366F1", "#0EA5E9"][(i - 1) % 3],
      // First stage is where work waits to begin; the rest are work happening.
      qualifies: (i === 0 ? "planned" : "ongoing") as StatusQualification,
    })),
    // Every template carries one, so a report that asks "what is stuck?" can be
    // answered in any of them rather than only in Standard.
    { id: hold, label: "On hold", color: "#E5484D", qualifies: "stalled" as StatusQualification },
    { id: DONE_STATUS_ID, label: "Done", color: "#12A594" },
  ];
}

export const BASELINE_CYCLES: BaselineCycle[] = [
  /**
   * Standard is first, and that is load-bearing (CY12a): CY4 pre-selects the
   * organisation's first cycle. It is also exactly `DEFAULT_STATUSES`, which is
   * what makes CY11 an identity for every Beat that predates cycles.
   */
  { id: "cy-standard", name: "Standard", statuses: DEFAULT_STATUSES, since: 1 },

  {
    id: "cy-pd-digital",
    name: "Product development (digital)",
    statuses: stages([
      ["pdd-discovery", "Discovery"],
      ["pdd-design", "Design"],
      ["pdd-build", "Build"],
      ["pdd-test", "Test"],
    ], "pdd-hold"),
    since: 2,
  },
  {
    id: "cy-pd-physical",
    name: "Product development (physical)",
    statuses: stages([
      ["pdp-concept", "Concept"],
      ["pdp-design", "Design"],
      ["pdp-prototype", "Prototype"],
      ["pdp-pilot", "Pilot run"],
    ], "pdp-hold"),
    since: 2,
  },
  {
    // Compliance and Approval are separate stages on purpose: a compliance
    // review and a committee sign-off are different gates, and a financial
    // product routinely clears one and waits on the other.
    id: "cy-pd-financial",
    name: "Product development (financial)",
    statuses: stages([
      ["pdf-proposal", "Proposal"],
      ["pdf-modelling", "Modelling"],
      ["pdf-compliance", "Compliance"],
      ["pdf-approval", "Approval"],
    ], "pdf-hold"),
    since: 2,
  },
  {
    // RIBA stages 1–4, in the words architects already use for them.
    id: "cy-arch-design",
    name: "Architecture (design)",
    statuses: stages([
      ["ad-brief", "Brief"],
      ["ad-concept", "Concept"],
      ["ad-developed", "Developed design"],
      ["ad-technical", "Technical design"],
    ], "ad-hold"),
    since: 2,
  },
  {
    // RIBA 5–6: the build itself, then closing it out.
    id: "cy-arch-construction",
    name: "Architecture (construction)",
    statuses: stages([
      ["ac-procurement", "Procurement"],
      ["ac-mobilisation", "Mobilisation"],
      ["ac-onsite", "On site"],
      ["ac-snagging", "Snagging"],
    ], "ac-hold"),
    since: 2,
  },
  {
    id: "cy-marketing-campaign",
    name: "Marketing campaign",
    statuses: stages([
      ["mc-brief", "Brief"],
      ["mc-creative", "Creative"],
      ["mc-approval", "Approval"],
      ["mc-live", "Live"],
    ], "mc-hold"),
    since: 2,
  },
  {
    id: "cy-product-launch",
    name: "Product launch",
    statuses: stages([
      ["pl-plan", "Plan"],
      ["pl-prepare", "Prepare"],
      ["pl-beta", "Beta"],
      ["pl-launch", "Launch"],
    ], "pl-hold"),
    since: 2,
  },
];

/** The templates as they are stored — `since` is seeding bookkeeping and has no
 * meaning inside a Beat, so it never reaches the document. */
export function asCycles(list: BaselineCycle[]): Cycle[] {
  return list.map(({ since: _since, ...cycle }) => cycle);
}

/**
 * Which templates a workspace has not been offered yet.
 *
 * `seen` is what it has already been shown; `have` are the cycle ids it
 * currently holds, so a template that is still there is not added twice.
 */
export function cyclesToSeed(seen: number, have: Set<string>): Cycle[] {
  return asCycles(BASELINE_CYCLES.filter((c) => c.since > seen && !have.has(c.id)));
}
