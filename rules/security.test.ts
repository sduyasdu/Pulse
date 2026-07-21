// Multi-tenant isolation tests for firestore.rules, run against the local
// Firestore emulator (no live Firebase project needed — see package.json's
// `test:rules` script, which wraps this in `firebase emulators:exec`).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import {
  collection,
  deleteDoc,
  doc,
  type Firestore,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

const PROJECT_ID = "demo-pulse-rules-test";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

/** Write directly, bypassing security rules — for arranging test fixtures. */
async function seed(fn: (db: Firestore) => Promise<void>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
}

function dbAs(uid: string | null, email?: string) {
  const ctx = uid
    ? testEnv.authenticatedContext(uid, email ? { email } : undefined)
    : testEnv.unauthenticatedContext();
  return ctx.firestore();
}

async function seedPulse(pulseId: string, createdBy: string, members: Record<string, { email: string; role: string }>) {
  await seed(async (db) => {
    await setDoc(doc(db, "pulses", pulseId), {
      workspaceId: "w1",
      name: "Test Pulse",
      createdBy,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      graphConfig: { stepPx: 16, workPerStep: 1 },
    });
    for (const [uid, m] of Object.entries(members)) {
      await setDoc(doc(db, "pulses", pulseId, "pulseMembers", uid), {
        uid,
        email: m.email,
        role: m.role,
        joinedAt: Date.now(),
      });
    }
  });
}

describe("cross-tenant isolation", () => {
  it("denies a non-member reading the pulse doc, its subcollections, or by guessing IDs", async () => {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "owner" } });
    await seed(async (db) => {
      await setDoc(doc(db, "pulses", "p1", "features", "f1"), { title: "secret", x: 0, y: 0, duration: 1, status: "planned", resources: [] });
    });

    const bob = dbAs("bob", "bob@example.com");
    await assertFails(getDoc(doc(bob, "pulses", "p1")));
    await assertFails(getDoc(doc(bob, "pulses", "p1", "features", "f1")));
    await assertFails(getDoc(doc(bob, "pulses", "p1", "pulseMembers", "alice")));
    // guessing a made-up pulse id doesn't help either
    await assertFails(getDoc(doc(bob, "pulses", "does-not-exist", "features", "f1")));
  });

  it("denies a non-member writing into another tenant's Pulse", async () => {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "owner" } });
    const bob = dbAs("bob", "bob@example.com");
    await assertFails(
      setDoc(doc(bob, "pulses", "p1", "features", "f-bob"), { title: "hijack", x: 0, y: 0, duration: 1, status: "planned", resources: [] }),
    );
  });

  it("denies anonymous (signed-out) access entirely", async () => {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "owner" } });
    const anon = dbAs(null);
    await assertFails(getDoc(doc(anon, "pulses", "p1")));
  });

  it("lets a member list a subcollection at a known pulseId (plain, non-collection-group list)", async () => {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "owner" } });
    await seed(async (db) => {
      await setDoc(doc(db, "pulses", "p1", "features", "f1"), { title: "x", x: 0, y: 0, duration: 1, status: "planned", resources: [] });
    });
    const alice = dbAs("alice", "alice@example.com");
    const snap = await assertSucceeds(getDocs(collection(alice, "pulses", "p1", "features")));
    expect(snap.size).toBe(1);
  });
});

describe("role enforcement within a Pulse", () => {
  it("lets a viewer read but not write", async () => {
    await seedPulse("p1", "alice", {
      alice: { email: "alice@example.com", role: "owner" },
      bob: { email: "bob@example.com", role: "viewer" },
    });
    const bob = dbAs("bob", "bob@example.com");
    await assertSucceeds(getDoc(doc(bob, "pulses", "p1")));
    await assertFails(
      setDoc(doc(bob, "pulses", "p1", "features", "f1"), { title: "x", x: 0, y: 0, duration: 1, status: "planned", resources: [] }),
    );
  });

  it("lets an editor write features/epics/resources but not delete the Pulse or change membership roles", async () => {
    await seedPulse("p1", "alice", {
      alice: { email: "alice@example.com", role: "owner" },
      carol: { email: "carol@example.com", role: "editor" },
      bob: { email: "bob@example.com", role: "viewer" },
    });
    const carol = dbAs("carol", "carol@example.com");
    await assertSucceeds(
      setDoc(doc(carol, "pulses", "p1", "features", "f1"), { title: "x", x: 0, y: 0, duration: 1, status: "planned", resources: [] }),
    );
    await assertFails(deleteDoc(doc(carol, "pulses", "p1")));
    await assertFails(updateDoc(doc(carol, "pulses", "p1", "pulseMembers", "bob"), { role: "editor" }));
  });

  it("lets an owner do everything, including deleting the Pulse and managing members", async () => {
    await seedPulse("p1", "alice", {
      alice: { email: "alice@example.com", role: "owner" },
      bob: { email: "bob@example.com", role: "viewer" },
    });
    const alice = dbAs("alice", "alice@example.com");
    await assertSucceeds(
      setDoc(doc(alice, "pulses", "p1", "epics", "e1"), { name: "Epic", color: "#000", y0: 0, y1: 100 }),
    );
    await assertSucceeds(updateDoc(doc(alice, "pulses", "p1", "pulseMembers", "bob"), { role: "editor" }));
    await assertSucceeds(deleteDoc(doc(alice, "pulses", "p1")));
  });
});

describe("Pulse creation", () => {
  it("lets a signed-in user create a Pulse, grant themselves owner, and index it in their own dashboard list", async () => {
    const alice = dbAs("alice", "alice@example.com");
    await assertSucceeds(
      setDoc(doc(alice, "pulses", "new1"), {
        workspaceId: "w1",
        name: "New",
        createdBy: "alice",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        graphConfig: { stepPx: 16, workPerStep: 1 },
      }),
    );
    await assertSucceeds(
      setDoc(doc(alice, "pulses", "new1", "pulseMembers", "alice"), {
        uid: "alice",
        email: "alice@example.com",
        role: "owner",
        joinedAt: Date.now(),
      }),
    );
    await assertSucceeds(
      setDoc(doc(alice, "users", "alice", "myPulses", "new1"), { pulseId: "new1", role: "owner", name: "New" }),
    );
  });

  it("regression: batching the pulse doc and its own pulseMembers grant in one writeBatch fails (must be sequential)", async () => {
    // Documents a real gotcha hit in services/firestore/pulses.ts: within a
    // single writeBatch, every operation's rules are evaluated against the
    // PRE-COMMIT state, so pulseMembers.create's get() on the pulse doc
    // can't see the same batch's not-yet-committed pulse write. The app
    // code must do these as two separate awaited setDoc() calls.
    const alice = dbAs("alice", "alice@example.com");
    const batch = writeBatch(alice);
    batch.set(doc(alice, "pulses", "batched1"), {
      workspaceId: "w1",
      name: "Batched",
      createdBy: "alice",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      graphConfig: { stepPx: 16, workPerStep: 1 },
    });
    batch.set(doc(alice, "pulses", "batched1", "pulseMembers", "alice"), {
      uid: "alice",
      email: "alice@example.com",
      role: "owner",
      joinedAt: Date.now(),
    });
    await assertFails(batch.commit());
  });

  it("denies someone else granting themselves owner on a Pulse they didn't create", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "pulses", "p1"), {
        workspaceId: "w1",
        name: "Test",
        createdBy: "alice",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        graphConfig: { stepPx: 16, workPerStep: 1 },
      });
    });
    const bob = dbAs("bob", "bob@example.com");
    await assertFails(
      setDoc(doc(bob, "pulses", "p1", "pulseMembers", "bob"), {
        uid: "bob",
        email: "bob@example.com",
        role: "owner",
        joinedAt: Date.now(),
      }),
    );
  });
});

describe("dashboard index (users/{uid}/myPulses)", () => {
  it("lets a user read and manage only their own myPulses index", async () => {
    const alice = dbAs("alice", "alice@example.com");
    await assertSucceeds(setDoc(doc(alice, "users", "alice", "myPulses", "p1"), { pulseId: "p1", role: "owner" }));
    await assertSucceeds(getDocs(collection(alice, "users", "alice", "myPulses")));
  });

  it("denies reading or writing someone else's myPulses index", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "users", "alice", "myPulses", "p1"), { pulseId: "p1", role: "owner" });
    });
    const bob = dbAs("bob", "bob@example.com");
    await assertFails(getDocs(collection(bob, "users", "alice", "myPulses")));
    await assertFails(setDoc(doc(bob, "users", "alice", "myPulses", "p2"), { pulseId: "p2", role: "owner" }));
  });
});

describe("invite acceptance", () => {
  async function seedInvite(pulseId: string, email: string, role: string, invitedBy: string) {
    await seed(async (db) => {
      await setDoc(doc(db, "pulses", pulseId, "invites", email), { email, role, invitedBy, createdAt: Date.now() });
      await setDoc(doc(db, "inviteIndex", email, "pending", pulseId), { role, invitedBy, createdAt: Date.now() });
    });
  }

  it("lets an invited user create their own membership matching the invite's role", async () => {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "owner" } });
    await seedInvite("p1", "dave@example.com", "editor", "alice");

    const dave = dbAs("dave", "dave@example.com");
    await assertSucceeds(
      setDoc(doc(dave, "pulses", "p1", "pulseMembers", "dave"), {
        uid: "dave",
        email: "dave@example.com",
        role: "editor",
        joinedAt: Date.now(),
      }),
    );
  });

  it("denies self-granting membership with no matching invite", async () => {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "owner" } });
    const eve = dbAs("eve", "eve@example.com");
    await assertFails(
      setDoc(doc(eve, "pulses", "p1", "pulseMembers", "eve"), {
        uid: "eve",
        email: "eve@example.com",
        role: "editor",
        joinedAt: Date.now(),
      }),
    );
  });

  it("denies escalating to a role higher than the invite granted", async () => {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "owner" } });
    await seedInvite("p1", "dave@example.com", "viewer", "alice");

    const dave = dbAs("dave", "dave@example.com");
    await assertFails(
      setDoc(doc(dave, "pulses", "p1", "pulseMembers", "dave"), {
        uid: "dave",
        email: "dave@example.com",
        role: "owner", // invite only grants viewer
        joinedAt: Date.now(),
      }),
    );
  });

  it("denies creating an invite whose document id doesn't match its email field", async () => {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "owner" } });
    const alice = dbAs("alice", "alice@example.com");
    await assertFails(
      setDoc(doc(alice, "pulses", "p1", "invites", "dave@example.com"), {
        email: "someone-else@example.com",
        role: "editor",
        invitedBy: "alice",
        createdAt: Date.now(),
      }),
    );
  });

  it("lets an invited (not-yet-member) user discover their own pending invites via the inviteIndex, but not anyone else's", async () => {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "owner" } });
    await seedInvite("p1", "dave@example.com", "editor", "alice");
    await seedInvite("p1", "eve@example.com", "viewer", "alice");

    const dave = dbAs("dave", "dave@example.com");
    const mine = await assertSucceeds(getDocs(collection(dave, "inviteIndex", "dave@example.com", "pending")));
    expect(mine.docs.map((d) => d.id)).toEqual(["p1"]);

    await assertFails(getDocs(collection(dave, "inviteIndex", "eve@example.com", "pending")));
    // a direct get() on someone else's underlying invite doc is denied too
    await assertFails(getDoc(doc(dave, "pulses", "p1", "invites", "eve@example.com")));
  });

  it("lets an invited user clear their own invite index entries and invite doc after accepting", async () => {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "owner" } });
    await seedInvite("p1", "dave@example.com", "editor", "alice");
    const dave = dbAs("dave", "dave@example.com");
    await assertSucceeds(deleteDoc(doc(dave, "pulses", "p1", "invites", "dave@example.com")));
    await assertSucceeds(deleteDoc(doc(dave, "inviteIndex", "dave@example.com", "pending", "p1")));
  });

  it("lets an owner/editor list this Pulse's pending invites, but denies a viewer and non-members", async () => {
    await seedPulse("p1", "alice", {
      alice: { email: "alice@example.com", role: "owner" },
      bob: { email: "bob@example.com", role: "editor" },
      carol: { email: "carol@example.com", role: "viewer" },
    });
    await seedInvite("p1", "dave@example.com", "editor", "alice");
    await seedInvite("p1", "eve@example.com", "viewer", "alice");

    const alice = dbAs("alice", "alice@example.com");
    const owned = await assertSucceeds(getDocs(collection(alice, "pulses", "p1", "invites")));
    expect(owned.docs.map((d) => d.id).sort()).toEqual(["dave@example.com", "eve@example.com"]);

    const bob = dbAs("bob", "bob@example.com");
    await assertSucceeds(getDocs(collection(bob, "pulses", "p1", "invites")));

    const carol = dbAs("carol", "carol@example.com");
    await assertFails(getDocs(collection(carol, "pulses", "p1", "invites")));

    const frank = dbAs("frank", "frank@example.com"); // not a member at all
    await assertFails(getDocs(collection(frank, "pulses", "p1", "invites")));
  });

  it("lets only the owner change a member's role", async () => {
    await seedPulse("p1", "alice", {
      alice: { email: "alice@example.com", role: "owner" },
      bob: { email: "bob@example.com", role: "editor" },
      carol: { email: "carol@example.com", role: "viewer" },
    });
    const alice = dbAs("alice", "alice@example.com");
    await assertSucceeds(updateDoc(doc(alice, "pulses", "p1", "pulseMembers", "bob"), { role: "viewer" }));

    // an editor (non-owner) can't re-permission anyone
    const bob = dbAs("bob", "bob@example.com");
    await assertFails(updateDoc(doc(bob, "pulses", "p1", "pulseMembers", "carol"), { role: "editor" }));
  });

  it("lets a user read their OWN membership doc even when not a member (dashboard self-heal relies on this)", async () => {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "owner" } });
    // Frank was never (or is no longer) a member: reading his own member doc
    // must still be permitted and simply come back missing, so the dashboard
    // can prune the stale myPulses entry.
    const frank = dbAs("frank", "frank@example.com");
    const snap = await assertSucceeds(getDoc(doc(frank, "pulses", "p1", "pulseMembers", "frank")));
    expect(snap.exists()).toBe(false);
    // ...but he cannot read anyone else's membership doc.
    await assertFails(getDoc(doc(frank, "pulses", "p1", "pulseMembers", "alice")));
  });

  it("denies a viewer creating invites (only owner/editor can invite)", async () => {
    await seedPulse("p1", "alice", {
      alice: { email: "alice@example.com", role: "owner" },
      bob: { email: "bob@example.com", role: "viewer" },
    });
    const bob = dbAs("bob", "bob@example.com");
    await assertFails(
      setDoc(doc(bob, "pulses", "p1", "invites", "dave@example.com"), {
        email: "dave@example.com",
        role: "editor",
        invitedBy: "bob",
        createdAt: Date.now(),
      }),
    );
  });
});

describe("Pulse deletion ordering (regression)", () => {
  // Documents a real gotcha hit in services/firestore/pulses.ts's
  // deletePulse(): every subcollection's write rule (canEditPulse) and the
  // pulse doc's own delete rule (isPulseOwner) check the CALLER's own
  // pulseMembers doc. Delete that first and every subsequent cleanup step
  // denies itself — pulseMembers must be deleted last.
  it("deleting your own pulseMembers doc first locks you out of deleting the rest", async () => {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "owner" } });
    await seed(async (db) => {
      await setDoc(doc(db, "pulses", "p1", "features", "f1"), { title: "x", x: 0, y: 0, duration: 1, status: "planned", resources: [] });
    });
    const alice = dbAs("alice", "alice@example.com");
    await assertSucceeds(deleteDoc(doc(alice, "pulses", "p1", "pulseMembers", "alice")));
    // alice is no longer a recognized member -> denied, even though she
    // was the owner moments ago
    await assertFails(deleteDoc(doc(alice, "pulses", "p1", "features", "f1")));
    await assertFails(deleteDoc(doc(alice, "pulses", "p1")));
  });

  it("deleting other subcollections and the pulse doc BEFORE pulseMembers succeeds all the way through", async () => {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "owner" } });
    await seed(async (db) => {
      await setDoc(doc(db, "pulses", "p1", "features", "f1"), { title: "x", x: 0, y: 0, duration: 1, status: "planned", resources: [] });
    });
    const alice = dbAs("alice", "alice@example.com");
    await assertSucceeds(deleteDoc(doc(alice, "pulses", "p1", "features", "f1")));
    await assertSucceeds(deleteDoc(doc(alice, "pulses", "p1")));
    // pulseMembers deletion doesn't depend on the parent pulse doc existing
    await assertSucceeds(deleteDoc(doc(alice, "pulses", "p1", "pulseMembers", "alice")));
  });
});

describe("workspaces", () => {
  it("lets a user create their own personal workspace and owner membership", async () => {
    const alice = dbAs("alice", "alice@example.com");
    await assertSucceeds(
      setDoc(doc(alice, "workspaces", "ws1"), { name: "Alice", isPersonal: true, ownerId: "alice", createdAt: Date.now() }),
    );
    await assertSucceeds(
      setDoc(doc(alice, "workspaces", "ws1", "workspaceMembers", "alice"), { uid: "alice", role: "owner", joinedAt: Date.now() }),
    );
  });

  it("denies reading a workspace you don't belong to", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "workspaces", "ws1"), { name: "Alice", isPersonal: true, ownerId: "alice", createdAt: Date.now() });
      await setDoc(doc(db, "workspaces", "ws1", "workspaceMembers", "alice"), { uid: "alice", role: "owner", joinedAt: Date.now() });
    });
    const bob = dbAs("bob", "bob@example.com");
    await assertFails(getDoc(doc(bob, "workspaces", "ws1")));
  });

  it("denies granting yourself ownership of a workspace you didn't create", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "workspaces", "ws1"), { name: "Alice", isPersonal: true, ownerId: "alice", createdAt: Date.now() });
    });
    const bob = dbAs("bob", "bob@example.com");
    await assertFails(
      setDoc(doc(bob, "workspaces", "ws1", "workspaceMembers", "bob"), { uid: "bob", role: "owner", joinedAt: Date.now() }),
    );
  });
});
