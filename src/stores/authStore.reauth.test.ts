import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reauthentication, and the one line that makes it useful.
 *
 * `deleteAccount` is gated on the ID token's `auth_time`. Reauthenticating
 * refreshes the *session*, but a token already minted keeps its old `auth_time`
 * — so without a forced token refresh the retry presents the same stale claim
 * and is refused again. To the person pressing the button, that reads as the
 * button doing nothing.
 *
 * The dialog's own suite cannot see this: it mocks this store. So it is pinned
 * here, against a mocked `firebase/auth`.
 */
const getIdToken = vi.fn().mockResolvedValue("t");
const reauthenticateWithPopup = vi.fn().mockResolvedValue({});
const reauthenticateWithCredential = vi.fn().mockResolvedValue({});
const credential = vi.fn((email: string, password: string) => ({ email, password }));

let providerData: { providerId: string }[] = [{ providerId: "google.com" }];

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: () => () => {},
  signInWithPopup: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
  signOut: vi.fn(),
  updateProfile: vi.fn(),
  reauthenticateWithPopup: (...a: unknown[]) => reauthenticateWithPopup(...a),
  reauthenticateWithCredential: (...a: unknown[]) => reauthenticateWithCredential(...a),
  EmailAuthProvider: { credential: (e: string, p: string) => credential(e, p) },
}));
vi.mock("firebase/firestore", () => ({
  clearIndexedDbPersistence: vi.fn(), terminate: vi.fn(), doc: vi.fn(), getDoc: vi.fn(),
}));
vi.mock("@/lib/firebase", () => ({
  auth: {
    get currentUser() {
      return { email: "me@example.com", providerData, getIdToken };
    },
  },
  db: {},
  googleProvider: {},
}));
vi.mock("@/services/firestore/users", () => ({
  ensureUserDoc: vi.fn(), resolvePendingInvites: vi.fn(), updateUserProfile: vi.fn(),
}));

const { useAuthStore } = await import("./authStore");

beforeEach(() => {
  vi.clearAllMocks();
  getIdToken.mockResolvedValue("t");
  providerData = [{ providerId: "google.com" }];
});

describe("reauthenticate", () => {
  it("forces a new ID token, or the retry is refused on the same stale auth_time", async () => {
    const ok = await useAuthStore.getState().reauthenticate();
    expect(ok).toBe(true);
    expect(getIdToken).toHaveBeenCalledWith(true);
  });

  it("uses the popup for a Google account", async () => {
    await useAuthStore.getState().reauthenticate();
    expect(reauthenticateWithPopup).toHaveBeenCalledTimes(1);
    expect(reauthenticateWithCredential).not.toHaveBeenCalled();
  });

  it("uses the typed password for a password account", async () => {
    providerData = [{ providerId: "password" }];
    expect(useAuthStore.getState().needsPasswordToReauth()).toBe(true);
    const ok = await useAuthStore.getState().reauthenticate("hunter2");
    expect(ok).toBe(true);
    expect(credential).toHaveBeenCalledWith("me@example.com", "hunter2");
    expect(reauthenticateWithPopup).not.toHaveBeenCalled();
  });

  it("refuses a password account with no password, without calling firebase", async () => {
    providerData = [{ providerId: "password" }];
    expect(await useAuthStore.getState().reauthenticate()).toBe(false);
    expect(reauthenticateWithCredential).not.toHaveBeenCalled();
  });

  it("answers false rather than throwing when the user dismisses the popup", async () => {
    reauthenticateWithPopup.mockRejectedValueOnce(new Error("popup-closed-by-user"));
    expect(await useAuthStore.getState().reauthenticate()).toBe(false);
    // The token must NOT be refreshed on a failed proof.
    expect(getIdToken).not.toHaveBeenCalled();
  });
});
