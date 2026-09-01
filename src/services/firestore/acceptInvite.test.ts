import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";

/**
 * Accepting an invitation has to be idempotent, because two paths do it and
 * they race.
 *
 * The sign-in bootstrap sweeps every pending invitation for the address
 * (`resolvePendingInvites`); the invite page accepts the one it was opened for.
 * Opening an emailed link runs both. The sweep wins during sign-in, grants
 * membership, writes the dashboard entry and deletes the invite doc — and the
 * page then found no invite doc and told the user they could not join a Pulse
 * they had just joined, which was sitting on their dashboard.
 */

/** Docs the fake Firestore holds, keyed by path. */
let docs: Record<string, unknown> = {};
/** Paths whose read should be refused, to stand in for a rules denial. */
let denied = new Set<string>();

const pathOf = (...parts: string[]) => parts.join("/");

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: pathOf(...parts) }),
  collection: (_db: unknown, ...parts: string[]) => ({ path: pathOf(...parts) }),
  getDoc: (ref: { path: string }) => {
    if (denied.has(ref.path)) return Promise.reject(new Error("permission-denied"));
    const data = docs[ref.path];
    return Promise.resolve({ exists: () => data !== undefined, data: () => data });
  },
  getDocs: () => Promise.resolve({ empty: true, docs: [] }),
  setDoc: (ref: { path: string }, value: unknown) => {
    docs[ref.path] = value;
    return Promise.resolve();
  },
  writeBatch: () => ({
    set: (ref: { path: string }, v: unknown) => void (docs[ref.path] = v),
    delete: (ref: { path: string }) => void delete docs[ref.path],
    commit: () => Promise.resolve(),
  }),
  updateDoc: () => Promise.resolve(),
  deleteDoc: () => Promise.resolve(),
  onSnapshot: () => () => {},
  query: () => ({}),
  where: () => ({}),
}));
vi.mock("@/lib/firebase", () => ({ db: {}, auth: {}, googleProvider: {} }));

const { acceptInviteFor } = await import("./invites");

const PULSE = "p1";
const UID = "u1";
const EMAIL = "ana@example.com";
const MEMBER_PATH = `pulses/${PULSE}/pulseMembers/${UID}`;
const INVITE_PATH = `pulses/${PULSE}/invites/${EMAIL}`;

/** A signed-in, confirmed user. `reload`/`getIdToken` are what
 * `refreshVerification` calls. */
const user = (over: Partial<User> = {}) =>
  ({
    uid: UID,
    email: EMAIL,
    emailVerified: true,
    reload: () => Promise.resolve(),
    getIdToken: () => Promise.resolve("token"),
    ...over,
  }) as unknown as User;

beforeEach(() => {
  docs = {};
  denied = new Set();
});

describe("accepting an invitation that is still open", () => {
  it("joins and reports the invited role", async () => {
    docs[INVITE_PATH] = { email: EMAIL, role: "editor" };
    await expect(acceptInviteFor(PULSE, user())).resolves.toEqual({ ok: true, role: "editor" });
  });

  it("writes the membership", async () => {
    docs[INVITE_PATH] = { email: EMAIL, role: "viewer" };
    await acceptInviteFor(PULSE, user());
    expect(docs[MEMBER_PATH]).toMatchObject({ uid: UID, role: "viewer" });
  });

  it("consumes the invite", async () => {
    docs[INVITE_PATH] = { email: EMAIL, role: "viewer" };
    await acceptInviteFor(PULSE, user());
    expect(docs[INVITE_PATH]).toBeUndefined();
  });
});

// The reported bug, in each of the shapes it can take.
describe("accepting when the sweep already did it", () => {
  it("succeeds instead of claiming there is no invitation", async () => {
    // Exactly the post-sweep state: member, and the invite doc gone.
    docs[MEMBER_PATH] = { uid: UID, email: EMAIL, role: "editor", joinedAt: 1 };
    await expect(acceptInviteFor(PULSE, user())).resolves.toEqual({ ok: true, role: "editor" });
  });

  it("reports the role the sweep actually granted", async () => {
    docs[MEMBER_PATH] = { uid: UID, email: EMAIL, role: "taskLead", joinedAt: 1 };
    await expect(acceptInviteFor(PULSE, user())).resolves.toEqual({ ok: true, role: "taskLead" });
  });

  // Someone who joined earlier by copy-link may never have confirmed their
  // address. Asking them to confirm it in order to obtain access they already
  // have is a dead end.
  it("succeeds for an unverified member", async () => {
    docs[MEMBER_PATH] = { uid: UID, email: EMAIL, role: "viewer", joinedAt: 1 };
    await expect(acceptInviteFor(PULSE, user({ emailVerified: false }))).resolves.toEqual({ ok: true, role: "viewer" });
  });

  it("is safe to run twice", async () => {
    docs[INVITE_PATH] = { email: EMAIL, role: "editor" };
    const first = await acceptInviteFor(PULSE, user());
    const second = await acceptInviteFor(PULSE, user());
    expect(first).toEqual({ ok: true, role: "editor" });
    expect(second).toEqual({ ok: true, role: "editor" });
  });
});

describe("genuine failures still report", () => {
  it("says notFound when there is no invitation and no membership", async () => {
    await expect(acceptInviteFor(PULSE, user())).resolves.toEqual({ ok: false, reason: "notFound" });
  });

  // A revoked invite and one addressed to someone else are indistinguishable
  // from this side: the rule refuses the read either way.
  it("says notFound when the invite read is refused", async () => {
    denied.add(INVITE_PATH);
    await expect(acceptInviteFor(PULSE, user())).resolves.toEqual({ ok: false, reason: "notFound" });
  });

  it("says unverified when the address is not confirmed", async () => {
    docs[INVITE_PATH] = { email: EMAIL, role: "editor" };
    await expect(acceptInviteFor(PULSE, user({ emailVerified: false }))).resolves.toEqual({
      ok: false,
      reason: "unverified",
    });
  });

  // The membership probe must not turn a real denial into a false success.
  it("does not invent membership when the member read is refused", async () => {
    denied.add(MEMBER_PATH);
    await expect(acceptInviteFor(PULSE, user())).resolves.toEqual({ ok: false, reason: "notFound" });
  });
});
