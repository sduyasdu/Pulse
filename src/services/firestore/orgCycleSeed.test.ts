import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Backfilling the default cycle templates onto an org that predates them
 * (Cycles-Spec CY12).
 *
 * The property worth pinning is the one that would destroy a user's work
 * silently: "never seeded" and "deliberately emptied" are different states, and
 * this runs on every dashboard load. Get it wrong and someone who deleted a
 * template watches it come back each time they open the app, with nothing to
 * explain it and no error anywhere.
 */
let docs: Record<string, unknown> = {};
/** Paths whose READ the rules refuse. */
let denied = new Set<string>();
/** Paths whose WRITE the rules refuse, the read still succeeding — a member
 * who is not the owner is exactly this case. */
let deniedWrites = new Set<string>();
const writes: { path: string; value: unknown }[] = [];

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join("/") }),
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join("/") }),
  getDoc: (ref: { path: string }) => {
    if (denied.has(ref.path)) return Promise.reject(new Error("permission-denied"));
    const data = docs[ref.path];
    return Promise.resolve({ exists: () => data !== undefined, data: () => data });
  },
  updateDoc: (ref: { path: string }, value: unknown) => {
    if (denied.has(ref.path) || deniedWrites.has(ref.path)) return Promise.reject(new Error("permission-denied"));
    writes.push({ path: ref.path, value });
    return Promise.resolve();
  },
  setDoc: () => Promise.resolve(),
  getDocs: () => Promise.resolve({ empty: true, docs: [] }),
  onSnapshot: () => () => {},
  serverTimestamp: () => "ts",
  deleteField: () => "delete",
  query: () => ({}),
  where: () => ({}),
  writeBatch: () => ({ set: () => {}, update: () => {}, delete: () => {}, commit: () => Promise.resolve() }),
}));
vi.mock("@/lib/firebase", () => ({ db: {}, auth: {}, googleProvider: {}, functions: {} }));

const { seedOrgCycles } = await import("./workspaces");
const { BASELINE_CYCLES, CURRENT_SEED_VERSION } = await import("@/domain/baselineCycles");

const WS = "workspaces/personal-u1";

beforeEach(() => {
  docs = {};
  denied = new Set();
  deniedWrites = new Set();
  writes.length = 0;
});

const ids = (v: unknown) => ((v as { cycles?: { id: string }[] }).cycles ?? []).map((c) => c.id);
const v2Only = BASELINE_CYCLES.filter((c) => c.since === 2).map((c) => c.id);

describe("an org that has never been seeded", () => {
  it("is offered every template", () => {
    docs[WS] = { id: "personal-u1" };
    return seedOrgCycles("personal-u1").then(() => {
      expect(ids(writes[0].value)).toEqual(BASELINE_CYCLES.map((c) => c.id));
      expect((writes[0].value as { cyclesSeedVersion: number }).cyclesSeedVersion).toBe(CURRENT_SEED_VERSION);
    });
  });
});

describe("an org seeded before the version marker existed", () => {
  // Every active tenant. They hold the first batch and have no marker, so the
  // marker has to be *inferred* as 1 — the batch that shipped without one.
  const v1 = { id: "personal-u1", cycles: [{ id: "cy-standard" }, { id: "cy-simple" }, { id: "cy-review" }] };

  it("is offered exactly the templates added since", () => {
    docs[WS] = v1;
    return seedOrgCycles("personal-u1").then(() => {
      const after = ids(writes[0].value);
      expect(after.slice(0, 3)).toEqual(["cy-standard", "cy-simple", "cy-review"]);
      expect(after.slice(3)).toEqual(v2Only);
    });
  });

  it("does not resurrect a first-batch template it deleted", () => {
    // The case the inferred marker exists for. This org deleted Standard
    // before versioning shipped, so it holds only Review and carries no
    // marker. Reading the absent marker as 0 rather than 1 would treat the
    // whole first batch as never-offered and put Standard back — the very bug
    // the marker is here to prevent, on the one batch that predates it.
    //
    // The id check alone does not catch this: Standard is absent precisely
    // because it was deleted.
    docs[WS] = { id: "personal-u1", cycles: [{ id: "cy-review" }] };
    return seedOrgCycles("personal-u1").then(() => {
      expect(ids(writes[0].value)).not.toContain("cy-standard");
      expect(ids(writes[0].value)).toEqual(["cy-review", ...v2Only]);
    });
  });

  it("keeps the templates it already had, including ones no longer seeded", () => {
    // Simple and Review are out of the baseline set now. An org that has them
    // keeps them: they are its data, and dropping them from the list it is
    // offered is not the same as taking them away.
    docs[WS] = v1;
    return seedOrgCycles("personal-u1").then(() => {
      expect(ids(writes[0].value)).toContain("cy-simple");
      expect(ids(writes[0].value)).toContain("cy-review");
    });
  });
});

describe("an org that has deleted what it was offered", () => {
  it("does not get it back", () => {
    // THE test. Templates belong to the org once seeded, so an absent id means
    // either "new" or "deleted" — and this runs on every dashboard load. Adding
    // back whatever is missing would undo the deletion each time they opened
    // the app, silently and forever.
    docs[WS] = { id: "personal-u1", cycles: [], cyclesSeedVersion: CURRENT_SEED_VERSION };
    return seedOrgCycles("personal-u1").then(() => expect(writes).toEqual([]));
  });

  it("is still offered a genuinely newer batch", () => {
    // Deleted everything from v1, but has not seen v2. The difference between
    // "deleted" and "never offered" is exactly what the marker records.
    docs[WS] = { id: "personal-u1", cycles: [], cyclesSeedVersion: 1 };
    return seedOrgCycles("personal-u1").then(() => {
      expect(ids(writes[0].value)).toEqual(v2Only);
    });
  });
});

describe("an org that is already current", () => {
  it("is written to at all only once", () => {
    // It runs on every dashboard mount; the second run must do nothing.
    docs[WS] = { id: "personal-u1" };
    return seedOrgCycles("personal-u1")
      .then(() => { docs[WS] = { ...(writes[0].value as object), id: "personal-u1" }; })
      .then(() => seedOrgCycles("personal-u1"))
      .then(() => expect(writes).toHaveLength(1));
  });

  it("records the marker even when it adds nothing", () => {
    // Holds every template by id but has no marker. Without writing one, this
    // would re-read and re-decide on every dashboard load forever.
    docs[WS] = { id: "personal-u1", cycles: BASELINE_CYCLES.map((c) => ({ id: c.id })) };
    return seedOrgCycles("personal-u1").then(() => {
      expect(writes).toHaveLength(1);
      expect(writes[0].value).toEqual({ cyclesSeedVersion: CURRENT_SEED_VERSION });
    });
  });
});

describe("when it cannot write", () => {
  it("writes nothing for a workspace that does not exist", () => {
    return seedOrgCycles("personal-nobody").then(() => expect(writes).toEqual([]));
  });

  it("stays quiet when the read is refused", () => {
    docs[WS] = { id: "personal-u1" };
    denied.add(WS);
    return expect(seedOrgCycles("personal-u1")).resolves.toBeUndefined();
  });

  it("does not reject when the write is refused", () => {
    // A member who is not the owner: the read succeeds and the write does not.
    // This runs unattended on every dashboard mount, so an unhandled rejection
    // would surface as a console error on a screen where nothing went wrong.
    docs[WS] = { id: "personal-u1" };
    deniedWrites.add(WS);
    return expect(seedOrgCycles("personal-u1")).resolves.toBeUndefined();
  });
});
