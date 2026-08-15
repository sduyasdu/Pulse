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
  query,
  setDoc,
  updateDoc,
  where,
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

describe("granular roles (Permissions-Spec §4)", () => {
  const leadCaps = { readScope: "all", editScope: "lead", editEpics: false, editResources: false, editConfig: false, comment: true, invite: false, manageMembers: false, deletePulse: false };

  async function seedLeadFixture() {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "owner" } });
    await seed(async (db) => {
      await setDoc(doc(db, "pulses", "p1", "pulseMembers", "lee"), { uid: "lee", email: "lee@example.com", role: "taskLead", joinedAt: Date.now(), caps: leadCaps });
      await setDoc(doc(db, "pulses", "p1", "features", "f_led"), { title: "led", x: 0, y: 0, duration: 1, status: "planned", resources: [], leadUid: "lee", assignedUids: ["lee"] });
      await setDoc(doc(db, "pulses", "p1", "features", "f_other"), { title: "other", x: 0, y: 0, duration: 1, status: "planned", resources: [], leadUid: "zed", assignedUids: ["zed"] });
    });
  }

  it("Task Lead may update a task they lead, but not one they don't", async () => {
    await seedLeadFixture();
    const lee = dbAs("lee", "lee@example.com");
    await assertSucceeds(updateDoc(doc(lee, "pulses", "p1", "features", "f_led"), { title: "renamed" }));
    await assertFails(updateDoc(doc(lee, "pulses", "p1", "features", "f_other"), { title: "sneaky" }));
  });

  it("Task Lead may not reassign the lead to escape scope", async () => {
    await seedLeadFixture();
    const lee = dbAs("lee", "lee@example.com");
    await assertFails(updateDoc(doc(lee, "pulses", "p1", "features", "f_led"), { leadUid: "zed" }));
  });

  it("Task Lead may not create or delete features", async () => {
    await seedLeadFixture();
    const lee = dbAs("lee", "lee@example.com");
    await assertFails(setDoc(doc(lee, "pulses", "p1", "features", "f_new"), { title: "x", x: 0, y: 0, duration: 1, status: "planned", resources: [] }));
    await assertFails(deleteDoc(doc(lee, "pulses", "p1", "features", "f_led")));
  });

  it("Task Lead reads the whole Pulse (full read scope)", async () => {
    await seedLeadFixture();
    const lee = dbAs("lee", "lee@example.com");
    await assertSucceeds(getDoc(doc(lee, "pulses", "p1", "features", "f_other")));
  });

  it("a caps editor (editScope 'all') can update any feature", async () => {
    await seedLeadFixture();
    await seed(async (db) => {
      await setDoc(doc(db, "pulses", "p1", "pulseMembers", "ed"), { uid: "ed", email: "ed@example.com", role: "editor", joinedAt: Date.now(), caps: { ...leadCaps, editScope: "all" } });
    });
    const ed = dbAs("ed", "ed@example.com");
    await assertSucceeds(updateDoc(doc(ed, "pulses", "p1", "features", "f_other"), { title: "ok" }));
  });

  it("a member cannot self-escalate caps (only photo self-write is allowed)", async () => {
    await seedPulse("p1", "alice", {
      alice: { email: "alice@example.com", role: "owner" },
      bob: { email: "bob@example.com", role: "viewer" },
    });
    const bob = dbAs("bob", "bob@example.com");
    await assertSucceeds(updateDoc(doc(bob, "pulses", "p1", "pulseMembers", "bob"), { photoURL: "data:img" }));
    await assertFails(updateDoc(doc(bob, "pulses", "p1", "pulseMembers", "bob"), { caps: { ...leadCaps, editScope: "all" } }));
    await assertFails(updateDoc(doc(bob, "pulses", "p1", "pulseMembers", "bob"), { role: "editor" }));
  });

  const beatCaps = { readScope: "beat", editScope: "none", editEpics: false, editResources: false, editConfig: false, comment: true, invite: false, manageMembers: false, deletePulse: false };

  async function seedBeatFixture() {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "owner" } });
    await seed(async (db) => {
      await setDoc(doc(db, "pulses", "p1", "pulseMembers", "mo"), { uid: "mo", email: "mo@example.com", role: "myBeatViewer", joinedAt: Date.now(), caps: beatCaps });
      await setDoc(doc(db, "pulses", "p1", "features", "f_mine"), { title: "mine", x: 0, y: 0, duration: 1, status: "planned", resources: [], assignedUids: ["mo"], leadUid: null });
      await setDoc(doc(db, "pulses", "p1", "features", "f_not"), { title: "not", x: 0, y: 0, duration: 1, status: "planned", resources: [], assignedUids: ["zed"], leadUid: null });
    });
  }

  it("My-Beat Viewer reads a feature they're assigned to, not one they aren't", async () => {
    await seedBeatFixture();
    const mo = dbAs("mo", "mo@example.com");
    await assertSucceeds(getDoc(doc(mo, "pulses", "p1", "features", "f_mine")));
    await assertFails(getDoc(doc(mo, "pulses", "p1", "features", "f_not")));
  });

  it("My-Beat Viewer's array-contains query succeeds; an unconstrained list is rejected", async () => {
    await seedBeatFixture();
    const mo = dbAs("mo", "mo@example.com");
    await assertSucceeds(getDocs(query(collection(mo, "pulses", "p1", "features"), where("assignedUids", "array-contains", "mo"))));
    await assertFails(getDocs(collection(mo, "pulses", "p1", "features")));
  });

  it("My-Beat Viewer cannot write features", async () => {
    await seedBeatFixture();
    const mo = dbAs("mo", "mo@example.com");
    await assertFails(updateDoc(doc(mo, "pulses", "p1", "features", "f_mine"), { title: "hax" }));
  });

  it("a full viewer (legacy, no caps) can list all features", async () => {
    await seedPulse("p1", "alice", {
      alice: { email: "alice@example.com", role: "owner" },
      viv: { email: "viv@example.com", role: "viewer" },
    });
    await seed(async (db) => {
      await setDoc(doc(db, "pulses", "p1", "features", "f1"), { title: "x", x: 0, y: 0, duration: 1, status: "planned", resources: [] });
    });
    const viv = dbAs("viv", "viv@example.com");
    await assertSucceeds(getDocs(collection(viv, "pulses", "p1", "features")));
  });

  it("a join link may grant the scoped roles, but never owner", async () => {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "owner" } });
    const alice = dbAs("alice", "alice@example.com");
    await assertSucceeds(updateDoc(doc(alice, "pulses", "p1"), { invite: { token: "t1", role: "taskLead" } }));
    await assertSucceeds(updateDoc(doc(alice, "pulses", "p1"), { invite: { token: "t2", role: "myBeatViewer" } }));
    await assertFails(updateDoc(doc(alice, "pulses", "p1"), { invite: { token: "t3", role: "owner" } }));
  });

  it("scope is role-derived: no-caps and forged-caps scoped members are still enforced", async () => {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "owner" } });
    await seed(async (db) => {
      // As a link-join creates it: role only, no caps.
      await setDoc(doc(db, "pulses", "p1", "pulseMembers", "mo"), { uid: "mo", email: "mo@example.com", role: "myBeatViewer", joinedAt: Date.now() });
      // Forged escalated caps — must be IGNORED (scope comes from the role).
      await setDoc(doc(db, "pulses", "p1", "pulseMembers", "hax"), { uid: "hax", email: "hax@example.com", role: "myBeatViewer", joinedAt: Date.now(), caps: { readScope: "all", editScope: "all" } });
      await setDoc(doc(db, "pulses", "p1", "features", "f_mine"), { title: "m", x: 0, y: 0, duration: 1, status: "planned", resources: [], assignedUids: ["mo"] });
      await setDoc(doc(db, "pulses", "p1", "features", "f_theirs"), { title: "t", x: 0, y: 0, duration: 1, status: "planned", resources: [], assignedUids: ["zed"] });
    });
    const mo = dbAs("mo", "mo@example.com");
    await assertSucceeds(getDoc(doc(mo, "pulses", "p1", "features", "f_mine")));
    await assertFails(getDocs(collection(mo, "pulses", "p1", "features")));
    const hax = dbAs("hax", "hax@example.com");
    await assertFails(getDocs(collection(hax, "pulses", "p1", "features"))); // caps ignored → still beat-scoped
    await assertFails(getDoc(doc(hax, "pulses", "p1", "features", "f_theirs")));
    await assertFails(updateDoc(doc(hax, "pulses", "p1", "features", "f_theirs"), { title: "x" })); // caps ignored → no edit
  });
});

describe("activity log (Changelog-Spec)", () => {
  const entry = (actorUid: string, extra: Record<string, unknown> = {}) => ({
    actorUid, actorEmail: `${actorUid}@example.com`, at: Date.now(),
    entityKind: "feature", entityId: "f1", entityName: "Login", verb: "edit",
    summary: "edited Login", source: "client", ...extra,
  });

  it("a member may append an entry about their own action, but not forge the actor or mutate it", async () => {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "editor" }, bob: { email: "bob@example.com", role: "editor" } });
    const bob = dbAs("bob", "bob@example.com");
    await assertSucceeds(setDoc(doc(bob, "pulses", "p1", "activity", "a1"), entry("bob", { scopeUids: ["bob"] })));
    await assertFails(setDoc(doc(bob, "pulses", "p1", "activity", "a2"), entry("alice"))); // forged actor
    await assertFails(setDoc(doc(bob, "pulses", "p1", "activity", "a3"), entry("bob", { source: "server" }))); // client can't claim server
    await assertFails(updateDoc(doc(bob, "pulses", "p1", "activity", "a1"), { summary: "tampered" }));
    await assertFails(deleteDoc(doc(bob, "pulses", "p1", "activity", "a1")));
  });

  it("full readers see all activity; a My-Beat Viewer sees only their-beat entries via array-contains", async () => {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "owner" } });
    await seed(async (db) => {
      await setDoc(doc(db, "pulses", "p1", "pulseMembers", "mo"), { uid: "mo", email: "mo@example.com", role: "myBeatViewer", joinedAt: Date.now() });
      await setDoc(doc(db, "pulses", "p1", "activity", "a_mine"), { ...entry("alice", { scopeUids: ["mo"] }), entityId: "fm" });
      await setDoc(doc(db, "pulses", "p1", "activity", "a_admin"), { ...entry("alice"), entityKind: "member", entityId: "x", verb: "role-change" }); // no scopeUids
    });
    const alice = dbAs("alice", "alice@example.com");
    await assertSucceeds(getDocs(collection(alice, "pulses", "p1", "activity"))); // full read
    const mo = dbAs("mo", "mo@example.com");
    await assertSucceeds(getDoc(doc(mo, "pulses", "p1", "activity", "a_mine")));
    await assertFails(getDoc(doc(mo, "pulses", "p1", "activity", "a_admin"))); // admin entry hidden
    await assertSucceeds(getDocs(query(collection(mo, "pulses", "p1", "activity"), where("scopeUids", "array-contains", "mo"))));
    await assertFails(getDocs(collection(mo, "pulses", "p1", "activity"))); // unconstrained rejected
  });
});

describe("Pulse creation", () => {
  it("lets a signed-in user create a Pulse, grant themselves owner, and index it in their own dashboard list", async () => {
    // The Pulse-create rule now requires membership of the target workspace and
    // reads its quota counter, so the org has to exist for this to be a
    // realistic create (Plans-Spec §5, PL5).
    await seed(async (db) => {
      await setDoc(doc(db, "workspaces", "w1"), { id: "w1", name: "Alice", isPersonal: true, ownerId: "alice", createdAt: Date.now() });
      await setDoc(doc(db, "workspaces", "w1", "workspaceMembers", "alice"), { uid: "alice", role: "owner", joinedAt: Date.now() });
    });
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
  // The owner's half of that hazard is now closed structurally: since HA10 no
  // owner may delete their own membership while the Pulse still exists, so
  // they can't lock themselves out of their own cascade. An EDITOR still can.
  it("an owner can't delete their own membership first — the lockout is unreachable", async () => {
    await seedPulse("p1", "alice", { alice: { email: "alice@example.com", role: "owner" } });
    const alice = dbAs("alice", "alice@example.com");
    await assertFails(deleteDoc(doc(alice, "pulses", "p1", "pulseMembers", "alice")));
  });

  it("deleting your own pulseMembers doc first locks you out of deleting the rest", async () => {
    await seedPulse("p1", "alice", {
      alice: { email: "alice@example.com", role: "owner" },
      bob: { email: "bob@example.com", role: "editor" },
    });
    await seed(async (db) => {
      await setDoc(doc(db, "pulses", "p1", "features", "f1"), { title: "x", x: 0, y: 0, duration: 1, status: "planned", resources: [] });
    });
    const bob = dbAs("bob", "bob@example.com");
    await assertSucceeds(deleteDoc(doc(bob, "pulses", "p1", "pulseMembers", "bob")));
    // bob is no longer a recognized member -> denied, even though he
    // could edit moments ago
    await assertFails(deleteDoc(doc(bob, "pulses", "p1", "features", "f1")));
    await assertFails(deleteDoc(doc(bob, "pulses", "p1")));
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

describe("costs (Costs-Spec §7)", () => {
  const beatCaps = { readScope: "beat", editScope: "none", editEpics: false, editResources: false, editConfig: false, comment: true, invite: false, manageMembers: false, deletePulse: false };
  const leadCaps = { readScope: "all", editScope: "lead", editEpics: false, editResources: false, editConfig: false, comment: true, invite: false, manageMembers: false, deletePulse: false };

  const costDoc = (over: Record<string, unknown> = {}) => ({
    typeId: "ai",
    featureId: "f_led",
    quantities: { tokens: 1_000_000 },
    basis: "amount",
    amountMicros: 412_000_000,
    currency: "USD",
    attrs: { brand: "anthropic", model: "claude-opus-5", resourceId: null },
    createdBy: "lee",
    createdAt: Date.now(),
    scopeUids: ["lee"],
    ...over,
  });

  async function seedCostFixture() {
    await seedPulse("p1", "alice", {
      alice: { email: "alice@example.com", role: "owner" },
      eve: { email: "eve@example.com", role: "editor" },
    });
    await seed(async (db) => {
      await setDoc(doc(db, "pulses", "p1", "pulseMembers", "lee"), { uid: "lee", email: "lee@example.com", role: "taskLead", joinedAt: Date.now(), caps: leadCaps });
      await setDoc(doc(db, "pulses", "p1", "pulseMembers", "bea"), { uid: "bea", email: "bea@example.com", role: "myBeatViewer", joinedAt: Date.now(), caps: beatCaps });
      await setDoc(doc(db, "pulses", "p1", "features", "f_led"), { title: "led", x: 0, y: 0, duration: 1, status: "planned", resources: [], leadUid: "lee", assignedUids: ["lee", "bea"] });
      await setDoc(doc(db, "pulses", "p1", "features", "f_other"), { title: "other", x: 0, y: 0, duration: 1, status: "planned", resources: [], leadUid: "zed", assignedUids: ["zed"] });
      await setDoc(doc(db, "pulses", "p1", "costs", "c_mine"), costDoc({ scopeUids: ["lee", "bea"] }));
      await setDoc(doc(db, "pulses", "p1", "costs", "c_theirs"), costDoc({ featureId: "f_other", scopeUids: ["zed"] }));
    });
  }

  it("denies a non-member reading or writing costs", async () => {
    await seedCostFixture();
    const mallory = dbAs("mallory", "mallory@example.com");
    await assertFails(getDoc(doc(mallory, "pulses", "p1", "costs", "c_mine")));
    await assertFails(setDoc(doc(mallory, "pulses", "p1", "costs", "c_evil"), costDoc()));
  });

  it("lets an editor create, update and delete a cost on any task", async () => {
    await seedCostFixture();
    const eve = dbAs("eve", "eve@example.com");
    await assertSucceeds(setDoc(doc(eve, "pulses", "p1", "costs", "c_new"), costDoc({ createdBy: "eve" })));
    await assertSucceeds(updateDoc(doc(eve, "pulses", "p1", "costs", "c_theirs"), { amountMicros: 1 }));
    await assertSucceeds(deleteDoc(doc(eve, "pulses", "p1", "costs", "c_mine")));
  });

  it("rejects a cost with no featureId (CO5 — every cost hangs off a task)", async () => {
    await seedCostFixture();
    const eve = dbAs("eve", "eve@example.com");
    await assertFails(setDoc(doc(eve, "pulses", "p1", "costs", "c_orphan"), costDoc({ featureId: null })));
  });

  it("lets a Task Lead write costs on a task they lead, but not on one they don't", async () => {
    await seedCostFixture();
    const lee = dbAs("lee", "lee@example.com");
    await assertSucceeds(setDoc(doc(lee, "pulses", "p1", "costs", "c_lee"), costDoc()));
    await assertSucceeds(updateDoc(doc(lee, "pulses", "p1", "costs", "c_mine"), { amountMicros: 5 }));
    await assertSucceeds(deleteDoc(doc(lee, "pulses", "p1", "costs", "c_mine")));
    await assertFails(setDoc(doc(lee, "pulses", "p1", "costs", "c_sneak"), costDoc({ featureId: "f_other" })));
    await assertFails(updateDoc(doc(lee, "pulses", "p1", "costs", "c_theirs"), { amountMicros: 5 }));
    await assertFails(deleteDoc(doc(lee, "pulses", "p1", "costs", "c_theirs")));
  });

  it("stops a Task Lead re-parenting a cost onto a task outside their scope", async () => {
    await seedCostFixture();
    const lee = dbAs("lee", "lee@example.com");
    await assertFails(updateDoc(doc(lee, "pulses", "p1", "costs", "c_mine"), { featureId: "f_other" }));
  });

  it("scopes a My-Beat Viewer to costs on their own tasks", async () => {
    await seedCostFixture();
    const bea = dbAs("bea", "bea@example.com");
    await assertSucceeds(getDoc(doc(bea, "pulses", "p1", "costs", "c_mine")));
    await assertFails(getDoc(doc(bea, "pulses", "p1", "costs", "c_theirs")));
    // The unconstrained list is rejected wholesale; the scoped query is required.
    await assertFails(getDocs(collection(bea, "pulses", "p1", "costs")));
    await assertSucceeds(getDocs(query(collection(bea, "pulses", "p1", "costs"), where("scopeUids", "array-contains", "bea"))));
  });

  it("denies a My-Beat Viewer writing costs at all (editScope none)", async () => {
    await seedCostFixture();
    const bea = dbAs("bea", "bea@example.com");
    await assertFails(setDoc(doc(bea, "pulses", "p1", "costs", "c_bea"), costDoc({ createdBy: "bea" })));
    await assertFails(deleteDoc(doc(bea, "pulses", "p1", "costs", "c_mine")));
  });
});

describe("hourly rates (Costs-Spec §8.7)", () => {
  const adminCaps = { readScope: "all", editScope: "all", editEpics: true, editResources: true, editConfig: true, comment: true, invite: true, manageMembers: true, deletePulse: false, viewPeopleCost: true };
  const editorCaps = { ...adminCaps, manageMembers: false, viewPeopleCost: false };

  const rateDoc = (over: Record<string, unknown> = {}) => ({
    resourceId: "res1",
    hourlyCost: 95,
    currency: "USD",
    updatedAt: Date.now(),
    updatedBy: "alice",
    ...over,
  });

  async function seedRateFixture() {
    await seedPulse("p1", "alice", {
      alice: { email: "alice@example.com", role: "owner" },
      eve: { email: "eve@example.com", role: "editor" },
      viv: { email: "viv@example.com", role: "viewer" },
    });
    await seed(async (db) => {
      await setDoc(doc(db, "pulses", "p1", "resources", "res1"), { id: "res1", initials: "AA", name: "Ana", capacity: 100, type: null });
      await setDoc(doc(db, "pulses", "p1", "rates", "res1"), rateDoc());
    });
  }

  it("lets an owner read and write a rate", async () => {
    await seedRateFixture();
    const alice = dbAs("alice", "alice@example.com");
    await assertSucceeds(getDoc(doc(alice, "pulses", "p1", "rates", "res1")));
    await assertSucceeds(setDoc(doc(alice, "pulses", "p1", "rates", "res2"), rateDoc({ resourceId: "res2" })));
    await assertSucceeds(deleteDoc(doc(alice, "pulses", "p1", "rates", "res1")));
  });

  it("denies an EDITOR — pay is narrower than editResources", async () => {
    await seedRateFixture();
    const eve = dbAs("eve", "eve@example.com");
    await assertFails(getDoc(doc(eve, "pulses", "p1", "rates", "res1")));
    await assertFails(getDocs(collection(eve, "pulses", "p1", "rates")));
    await assertFails(setDoc(doc(eve, "pulses", "p1", "rates", "res1"), rateDoc({ hourlyCost: 1 })));
    await assertFails(deleteDoc(doc(eve, "pulses", "p1", "rates", "res1")));
  });

  it("denies a viewer and a non-member", async () => {
    await seedRateFixture();
    await assertFails(getDoc(doc(dbAs("viv", "viv@example.com"), "pulses", "p1", "rates", "res1")));
    await assertFails(getDoc(doc(dbAs("mallory", "m@example.com"), "pulses", "p1", "rates", "res1")));
  });

  it("still lets a non-admin read the resource itself — only the rate is protected", async () => {
    await seedRateFixture();
    const eve = dbAs("eve", "eve@example.com");
    await assertSucceeds(getDoc(doc(eve, "pulses", "p1", "resources", "res1")));
  });

  it("grants a custom role only when viewPeopleCost is set", async () => {
    await seedRateFixture();
    await seed(async (db) => {
      await setDoc(doc(db, "pulses", "p1", "pulseMembers", "cfo"), { uid: "cfo", email: "cfo@example.com", role: "custom", joinedAt: Date.now(), caps: adminCaps });
      await setDoc(doc(db, "pulses", "p1", "pulseMembers", "pm"), { uid: "pm", email: "pm@example.com", role: "custom", joinedAt: Date.now(), caps: editorCaps });
    });
    await assertSucceeds(getDoc(doc(dbAs("cfo", "cfo@example.com"), "pulses", "p1", "rates", "res1")));
    await assertFails(getDoc(doc(dbAs("pm", "pm@example.com"), "pulses", "p1", "rates", "res1")));
  });
});

describe("billing / plan doc (Plans-Spec §4)", () => {
  const WS = "ws1";
  async function seedWorkspace() {
    await seed(async (db) => {
      await setDoc(doc(db, "workspaces", WS), { id: WS, name: "Acme", isPersonal: false, ownerId: "owner", createdAt: Date.now() });
      await setDoc(doc(db, "workspaces", WS, "workspaceMembers", "owner"), { uid: "owner", role: "owner", joinedAt: Date.now() });
      await setDoc(doc(db, "workspaces", WS, "workspaceMembers", "member"), { uid: "member", role: "member", joinedAt: Date.now() });
      await setDoc(doc(db, "billing", WS), { tier: "pro", status: "active", source: "stripe", updatedAt: Date.now() });
    });
  }

  it("only the org admin (workspace owner) may read the billing doc", async () => {
    await seedWorkspace();
    await assertSucceeds(getDoc(doc(dbAs("owner"), "billing", WS)));
    await assertFails(getDoc(doc(dbAs("member"), "billing", WS))); // non-owner member
    await assertFails(getDoc(doc(dbAs("stranger"), "billing", WS))); // non-member
    await assertFails(getDoc(doc(dbAs(null), "billing", WS))); // unauthenticated
  });

  it("no client may ever write the billing doc — Stripe/SF3 only", async () => {
    await seedWorkspace();
    const asOwner = dbAs("owner");
    await assertFails(setDoc(doc(asOwner, "billing", WS), { tier: "team", status: "active", source: "stripe", updatedAt: Date.now() }));
    await assertFails(updateDoc(doc(asOwner, "billing", WS), { tier: "team" }));
    await assertFails(deleteDoc(doc(asOwner, "billing", WS)));
    // Even minting a fresh billing doc for a workspace you own is denied.
    await assertFails(setDoc(doc(asOwner, "billing", "ws-new"), { tier: "pro", status: "active", source: "stripe", updatedAt: Date.now() }));
  });
});

describe("hide & archive (Hide-and-Archive-Spec)", () => {
  /** Seed a Pulse with alice as owner + bob as editor, optionally archived. */
  async function seedArchivable(archived: boolean) {
    await seedPulse("p1", "alice", {
      alice: { email: "alice@example.com", role: "owner" },
      bob: { email: "bob@example.com", role: "editor" },
    });
    await seed(async (db) => {
      if (archived) {
        await updateDoc(doc(db, "pulses", "p1"), { archivedAt: Date.now(), archivedBy: "alice" });
      }
      await setDoc(doc(db, "pulses", "p1", "epics", "e1"), { id: "e1", name: "Epic" });
      await setDoc(doc(db, "pulses", "p1", "features", "f1"), { id: "f1", title: "Task", assignedUids: [] });
      await setDoc(doc(db, "pulses", "p1", "resources", "r1"), { id: "r1", name: "Ana" });
      await setDoc(doc(db, "pulses", "p1", "comments", "c1"), { id: "c1", authorUid: "bob", body: "hi", targetId: null });
      await setDoc(doc(db, "pulses", "p1", "costs", "k1"), { id: "k1", featureId: "f1", amountMicros: 1, scopeUids: [] });
      await setDoc(doc(db, "pulses", "p1", "rates", "r1"), { hourlyMicros: 1 });
    });
  }

  it("an owner may archive; an editor may not (HA1)", async () => {
    await seedArchivable(false);
    const bob = dbAs("bob", "bob@example.com");
    await assertFails(updateDoc(doc(bob, "pulses", "p1"), { archivedAt: Date.now(), archivedBy: "bob", updatedAt: Date.now() }));
    const alice = dbAs("alice", "alice@example.com");
    await assertSucceeds(updateDoc(doc(alice, "pulses", "p1"), { archivedAt: Date.now(), archivedBy: "alice", updatedAt: Date.now() }));
  });

  it("freezes every content write path for an editor, and thaws on unarchive", async () => {
    await seedArchivable(true);
    const bob = dbAs("bob", "bob@example.com");
    await assertFails(setDoc(doc(bob, "pulses", "p1", "epics", "e2"), { id: "e2", name: "New" }));
    await assertFails(updateDoc(doc(bob, "pulses", "p1", "epics", "e1"), { name: "Renamed" }));
    await assertFails(setDoc(doc(bob, "pulses", "p1", "features", "f2"), { id: "f2", title: "New", assignedUids: [] }));
    await assertFails(updateDoc(doc(bob, "pulses", "p1", "features", "f1"), { title: "Renamed" }));
    await assertFails(updateDoc(doc(bob, "pulses", "p1", "resources", "r1"), { name: "Bea" }));
    await assertFails(setDoc(doc(bob, "pulses", "p1", "costs", "k2"), { id: "k2", featureId: "f1", amountMicros: 2, scopeUids: [] }));
    await assertFails(updateDoc(doc(bob, "pulses", "p1"), { name: "Renamed" }));
    // …and all of it works again once an owner unarchives.
    await seed(async (db) => updateDoc(doc(db, "pulses", "p1"), { archivedAt: null, archivedBy: null }));
    await assertSucceeds(updateDoc(doc(bob, "pulses", "p1", "features", "f1"), { title: "Renamed" }));
    await assertSucceeds(updateDoc(doc(bob, "pulses", "p1", "epics", "e1"), { name: "Renamed" }));
  });

  it("comments freeze too, while staying readable (HA2)", async () => {
    await seedArchivable(true);
    const bob = dbAs("bob", "bob@example.com");
    await assertSucceeds(getDoc(doc(bob, "pulses", "p1", "comments", "c1")));
    await assertFails(setDoc(doc(bob, "pulses", "p1", "comments", "c2"), { id: "c2", authorUid: "bob", body: "again", targetId: null }));
    await assertFails(updateDoc(doc(bob, "pulses", "p1", "comments", "c1"), { body: "edited" }));
  });

  it("an owner can still delete content while archived, so deletePulse's cascade works (HA4)", async () => {
    await seedArchivable(true);
    const alice = dbAs("alice", "alice@example.com");
    await assertSucceeds(deleteDoc(doc(alice, "pulses", "p1", "epics", "e1")));
    await assertSucceeds(deleteDoc(doc(alice, "pulses", "p1", "features", "f1")));
    await assertSucceeds(deleteDoc(doc(alice, "pulses", "p1", "resources", "r1")));
    await assertSucceeds(deleteDoc(doc(alice, "pulses", "p1", "costs", "k1")));
    await assertSucceeds(deleteDoc(doc(alice, "pulses", "p1", "comments", "c1")));
    await assertSucceeds(deleteDoc(doc(alice, "pulses", "p1")));
    // An editor gets no such exemption — the freeze still holds for them.
    await seedArchivable(true);
    const bob = dbAs("bob", "bob@example.com");
    await assertFails(deleteDoc(doc(bob, "pulses", "p1", "epics", "e1")));
  });

  it("rates stay READABLE while archived, but not writable", async () => {
    await seedArchivable(true);
    const alice = dbAs("alice", "alice@example.com"); // owner = canViewPeopleCost
    await assertSucceeds(getDoc(doc(alice, "pulses", "p1", "rates", "r1")));
    await assertFails(updateDoc(doc(alice, "pulses", "p1", "rates", "r1"), { hourlyMicros: 2 }));
  });

  it("the archive write may not carry anything else, and can't forge archivedBy", async () => {
    await seedArchivable(false);
    const alice = dbAs("alice", "alice@example.com");
    await assertFails(updateDoc(doc(alice, "pulses", "p1"), { archivedAt: Date.now(), archivedBy: "alice", name: "Sneaky", updatedAt: Date.now() }));
    await assertFails(updateDoc(doc(alice, "pulses", "p1"), { archivedAt: Date.now(), archivedBy: "bob", updatedAt: Date.now() }));
    await assertFails(updateDoc(doc(alice, "pulses", "p1"), { archivedAt: Date.now(), updatedAt: Date.now() })); // archivedBy missing
    // Unarchive must clear archivedBy, not leave it dangling.
    await seed(async (db) => updateDoc(doc(db, "pulses", "p1"), { archivedAt: Date.now(), archivedBy: "alice" }));
    await assertFails(updateDoc(doc(alice, "pulses", "p1"), { archivedAt: null, updatedAt: Date.now() }));
    await assertSucceeds(updateDoc(doc(alice, "pulses", "p1"), { archivedAt: null, archivedBy: null, updatedAt: Date.now() }));
  });

  it("an editor can't set the archive fields through the ordinary update path", async () => {
    await seedArchivable(false);
    const bob = dbAs("bob", "bob@example.com");
    await assertFails(updateDoc(doc(bob, "pulses", "p1"), { name: "Renamed", archivedAt: Date.now(), updatedAt: Date.now() }));
    await assertSucceeds(updateDoc(doc(bob, "pulses", "p1"), { name: "Renamed", updatedAt: Date.now() }));
  });

  it("a Pulse may not be created already archived", async () => {
    const alice = dbAs("alice", "alice@example.com");
    await assertFails(setDoc(doc(alice, "pulses", "born"), {
      workspaceId: "w1", name: "Born archived", createdBy: "alice", createdAt: Date.now(),
      updatedAt: Date.now(), graphConfig: { stepPx: 16, workPerStep: 1 }, archivedAt: Date.now(),
    }));
  });

  it("a join link goes inert while archived, and works again after unarchive (HA3)", async () => {
    await seedArchivable(true);
    await seed(async (db) => updateDoc(doc(db, "pulses", "p1"), { invite: { token: "tok", role: "editor" } }));
    const carol = dbAs("carol", "carol@example.com");
    const join = () => setDoc(doc(carol, "pulses", "p1", "pulseMembers", "carol"), {
      uid: "carol", email: "carol@example.com", role: "editor", joinedAt: Date.now(), joinToken: "tok",
    });
    await assertFails(join());
    await seed(async (db) => updateDoc(doc(db, "pulses", "p1"), { archivedAt: null, archivedBy: null }));
    await assertSucceeds(join());
  });

  it("presence, own-member self-update, activity and the myPulses index stay writable while archived", async () => {
    await seedArchivable(true);
    const bob = dbAs("bob", "bob@example.com");
    await assertSucceeds(setDoc(doc(bob, "pulses", "p1", "presence", "bob"), { uid: "bob", email: "bob@example.com", lastSeen: Date.now() }));
    await assertSucceeds(updateDoc(doc(bob, "pulses", "p1", "pulseMembers", "bob"), { photoURL: "https://x/y.png" }));
    await assertSucceeds(setDoc(doc(bob, "pulses", "p1", "activity", "a1"), {
      actorUid: "bob", actorEmail: "bob@example.com", at: Date.now(), entityKind: "pulse",
      entityId: "p1", entityName: "Test Pulse", verb: "archive", summary: "archived the Pulse", source: "client",
    }));
    await assertSucceeds(setDoc(doc(bob, "users", "bob", "myPulses", "p1"), {
      pulseId: "p1", name: "Test Pulse", workspaceId: "w1", role: "editor", joinedAt: Date.now(), hidden: true,
    }));
  });

  it("reads are untouched by the freeze, including a My-Beat Viewer's scoped query", async () => {
    await seedArchivable(true);
    await seed(async (db) => {
      await setDoc(doc(db, "pulses", "p1", "pulseMembers", "mo"), { uid: "mo", email: "mo@example.com", role: "myBeatViewer", joinedAt: Date.now() });
      await setDoc(doc(db, "pulses", "p1", "features", "fm"), { id: "fm", title: "Mine", assignedUids: ["mo"] });
    });
    const bob = dbAs("bob", "bob@example.com");
    await assertSucceeds(getDoc(doc(bob, "pulses", "p1")));
    await assertSucceeds(getDocs(collection(bob, "pulses", "p1", "features")));
    const mo = dbAs("mo", "mo@example.com");
    await assertSucceeds(getDocs(query(collection(mo, "pulses", "p1", "features"), where("assignedUids", "array-contains", "mo"))));
  });

  it("no owner may remove themselves, archived or not — the always-an-owner invariant (HA10)", async () => {
    await seedArchivable(false);
    await seed(async (db) => {
      await setDoc(doc(db, "pulses", "p1", "pulseMembers", "carol"), { uid: "carol", email: "carol@example.com", role: "owner", joinedAt: Date.now() });
    });
    // Sole-ness is irrelevant to the rule: even with two owners, self-delete is denied.
    await assertFails(deleteDoc(doc(dbAs("alice", "alice@example.com"), "pulses", "p1", "pulseMembers", "alice")));
    // Non-owners may still leave.
    await assertSucceeds(deleteDoc(doc(dbAs("bob", "bob@example.com"), "pulses", "p1", "pulseMembers", "bob")));
    // A co-owner may remove an owner…
    await assertSucceeds(deleteDoc(doc(dbAs("carol", "carol@example.com"), "pulses", "p1", "pulseMembers", "alice")));
  });

  it("an owner who steps down to editor may then leave", async () => {
    await seedArchivable(false);
    await seed(async (db) => {
      await setDoc(doc(db, "pulses", "p1", "pulseMembers", "carol"), { uid: "carol", email: "carol@example.com", role: "owner", joinedAt: Date.now() });
    });
    const alice = dbAs("alice", "alice@example.com");
    await assertSucceeds(updateDoc(doc(alice, "pulses", "p1", "pulseMembers", "alice"), { role: "editor" }));
    await assertSucceeds(deleteDoc(doc(alice, "pulses", "p1", "pulseMembers", "alice")));
  });
});

describe("plan quotas — Pulse count (Plans-Spec §3.2/§5, PL5)", () => {
  const WS = "wq";

  /** An org with `pulseCount` already materialized by SF11, optionally on a paid
   * plan. `pulseCount` is seeded directly because only the server may write it. */
  async function seedOrg(pulseCount: number | undefined, billing?: { tier: string; status: string }) {
    await seed(async (db) => {
      await setDoc(doc(db, "workspaces", WS), {
        id: WS, name: "Acme", isPersonal: false, ownerId: "owner", createdAt: Date.now(),
        ...(pulseCount === undefined ? {} : { pulseCount }),
      });
      await setDoc(doc(db, "workspaces", WS, "workspaceMembers", "owner"), { uid: "owner", role: "owner", joinedAt: Date.now() });
      if (billing) await setDoc(doc(db, "billing", WS), { ...billing, source: "stripe", updatedAt: Date.now() });
    });
  }

  const newPulse = (db: Firestore, id: string) =>
    setDoc(doc(db, "pulses", id), {
      workspaceId: WS, name: "New", createdBy: "owner", createdAt: Date.now(), updatedAt: Date.now(),
      graphConfig: { stepPx: 16, workPerStep: 1 },
    });

  // ── the allow side — where a quota gate is most likely to break something ──
  it("allows creating under the Starter cap", async () => {
    await seedOrg(2); // 2 of 3
    await assertSucceeds(newPulse(dbAs("owner"), "pnew"));
  });

  it("blocks the create that would exceed the Starter cap", async () => {
    await seedOrg(3); // at 3 of 3
    await assertFails(newPulse(dbAs("owner"), "pnew"));
  });

  it("lets a paid org past the Starter cap, up to its own", async () => {
    await seedOrg(3, { tier: "pro", status: "active" }); // Starter would block; Pro allows 5
    await assertSucceeds(newPulse(dbAs("owner"), "pnew"));
  });

  it("blocks a Pro org at its own cap of 5", async () => {
    await seedOrg(5, { tier: "pro", status: "active" });
    await assertFails(newPulse(dbAs("owner"), "pnew"));
  });

  it("never blocks Business (unlimited)", async () => {
    await seedOrg(999, { tier: "business", status: "active" });
    await assertSucceeds(newPulse(dbAs("owner"), "pnew"));
  });

  it("treats a cancelled subscription as Starter", async () => {
    await seedOrg(3, { tier: "pro", status: "canceled" });
    await assertFails(newPulse(dbAs("owner"), "pnew"));
  });

  it("keeps the paid tier while past_due — dunning decides, not the quota", async () => {
    await seedOrg(4, { tier: "pro", status: "past_due" });
    await assertSucceeds(newPulse(dbAs("owner"), "pnew"));
  });

  // Deleting is how an over-quota org gets back under its cap, so the gate must
  // not touch it (CLAUDE.md — check every new write gate against the cascade).
  it("still allows deleting a Pulse while over quota", async () => {
    await seedOrg(9, { tier: "pro", status: "active" }); // 9 > 5, well over
    // Belongs to the over-quota org specifically — seedPulse would pin it to
    // "w1" and quietly test nothing.
    await seed(async (db) => {
      await setDoc(doc(db, "pulses", "pdel"), {
        workspaceId: WS, name: "Doomed", createdBy: "alice", createdAt: Date.now(), updatedAt: Date.now(),
        graphConfig: { stepPx: 16, workPerStep: 1 },
      });
      await setDoc(doc(db, "pulses", "pdel", "pulseMembers", "alice"), { uid: "alice", email: "alice@example.com", role: "owner", joinedAt: Date.now() });
    });
    // Deleting is how an org gets back under its cap, so it must stay ungated.
    await assertSucceeds(deleteDoc(doc(dbAs("alice", "alice@example.com"), "pulses", "pdel")));
  });

  it("denies creating a Pulse in an org you don't belong to", async () => {
    await seedOrg(0); // room to spare — membership is what fails, not the count
    await assertFails(newPulse(dbAs("outsider"), "psneak"));
  });

  it("an org with no counter yet is not locked out", async () => {
    await seedOrg(undefined); // pre-SF11 workspace: field absent ⇒ 0
    await assertSucceeds(newPulse(dbAs("owner"), "pnew"));
  });

  // ── the counter itself must be server-only, or the gate is decoration ──
  it("denies a workspace owner writing pulseCount", async () => {
    await seedOrg(3);
    await assertFails(updateDoc(doc(dbAs("owner"), "workspaces", WS), { pulseCount: 0 }));
  });

  it("denies smuggling pulseCount alongside a legitimate field", async () => {
    await seedOrg(3);
    await assertFails(updateDoc(doc(dbAs("owner"), "workspaces", WS), { name: "Renamed", pulseCount: 0 }));
  });

  it("still allows an ordinary workspace update", async () => {
    await seedOrg(3);
    await assertSucceeds(updateDoc(doc(dbAs("owner"), "workspaces", WS), { name: "Renamed" }));
  });

  it("denies creating a workspace with a forged counter", async () => {
    await assertFails(
      setDoc(doc(dbAs("mallory"), "workspaces", "wforge"), {
        name: "Mine", isPersonal: true, ownerId: "mallory", createdAt: Date.now(), pulseCount: 0,
      }),
    );
  });
});
