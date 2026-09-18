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

const { seedOrgCyclesIfAbsent } = await import("./workspaces");
const { DEFAULT_ORG_CYCLES } = await import("@/domain/constants");

const WS = "workspaces/personal-u1";

beforeEach(() => {
  docs = {};
  denied = new Set();
  deniedWrites = new Set();
  writes.length = 0;
});

describe("seeding default cycles onto an existing org", () => {
  it("writes them when the field has never existed", () => {
    docs[WS] = { id: "personal-u1", name: "Mine" };
    return seedOrgCyclesIfAbsent("personal-u1").then(() => {
      expect(writes).toHaveLength(1);
      expect(writes[0].value).toEqual({ cycles: DEFAULT_ORG_CYCLES });
    });
  });

  it("leaves a deliberately emptied list alone", () => {
    // THE test. `cycles: []` means someone opened the editor and removed them.
    // This runs on every dashboard load, so writing the defaults back would
    // undo that edit every time they opened the app.
    docs[WS] = { id: "personal-u1", cycles: [] };
    return seedOrgCyclesIfAbsent("personal-u1").then(() => {
      expect(writes).toEqual([]);
    });
  });

  it("does not overwrite templates the org has customised", () => {
    docs[WS] = { id: "personal-u1", cycles: [{ id: "c1", name: "Ours", statuses: [] }] };
    return seedOrgCyclesIfAbsent("personal-u1").then(() => {
      expect(writes).toEqual([]);
    });
  });

  it("is idempotent across loads", () => {
    // It runs on every dashboard mount; the second run must see what the first
    // wrote and stop.
    docs[WS] = { id: "personal-u1" };
    return seedOrgCyclesIfAbsent("personal-u1")
      .then(() => { docs[WS] = { ...(docs[WS] as object), cycles: DEFAULT_ORG_CYCLES }; })
      .then(() => seedOrgCyclesIfAbsent("personal-u1"))
      .then(() => expect(writes).toHaveLength(1));
  });

  it("writes nothing for a workspace that does not exist", () => {
    return seedOrgCyclesIfAbsent("personal-nobody").then(() => expect(writes).toEqual([]));
  });

  it("stays quiet when the rules refuse", () => {
    // A member who is not the owner. Nothing to do and nothing to report —
    // the same call `roleSelfHeal` makes.
    docs[WS] = { id: "personal-u1" };
    denied.add(WS);
    return expect(seedOrgCyclesIfAbsent("personal-u1")).resolves.toBeUndefined();
  });

  it("does not reject when the write itself is refused", async () => {
    // The read succeeds and the write is denied — a workspace member who is not
    // the owner. This runs unattended on every dashboard mount, so an
    // unhandled rejection here would surface as a console error on a screen
    // where the user did nothing wrong.
    docs[WS] = { id: "personal-u1" };
    deniedWrites.add(WS);
    await expect(seedOrgCyclesIfAbsent("personal-u1")).resolves.toBeUndefined();
    expect(writes).toEqual([]);
  });
});
