import { create } from "zustand";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User as FirebaseUser,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "@/lib/firebase";
import type { UserDoc } from "@/types";
import { ensureUserDoc, resolvePendingInvites, updateUserProfile } from "@/services/firestore/users";
import { useI18nStore } from "@/stores/i18nStore";
import { isLang } from "@/i18n/langs";

interface AuthState {
  firebaseUser: FirebaseUser | null;
  userDoc: UserDoc | null;
  /** True until the very first onAuthStateChanged callback has fired. */
  initializing: boolean;
  /** True while the post-sign-in bootstrap (user doc + invite resolution)
   * is in flight — the dashboard should wait for this before querying
   * myPulses, since a freshly-accepted invite might not be indexed yet. */
  bootstrapping: boolean;
  /** Whether the signed-in address is confirmed. Mirrored into the store rather
   * than read off `firebaseUser.emailVerified`, because `reload()` mutates that
   * object in place — nothing re-renders, and the banner telling someone to
   * confirm their address would stay up after they had. */
  emailVerified: boolean;
  error: string | null;
  init: () => () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
  /** Save the current user's profile (name / avatar / language) and update local
   * state. `language: null` clears the override. */
  saveProfile: (patch: { displayName?: string | null; photoURL?: string | null; language?: string | null }) => Promise<void>;
  signOutUser: () => Promise<void>;
  /** Re-send the confirmation link. Needed because an unverified address cannot
   * accept an emailed invitation (firestore.rules), and the mail sent at signup
   * is easy to lose. Returns false when there is nothing to send — already
   * verified, or signed in with Google, which supplies a verified address. */
  resendVerification: () => Promise<boolean>;
  /** Ask the server whether the address has been confirmed since sign-in, mint
   * a token carrying the new claim, and — if it has — sweep up the invitations
   * that were unacceptable until now. Returns the confirmed state. */
  recheckVerification: () => Promise<boolean>;
}

async function bootstrap(user: FirebaseUser): Promise<UserDoc | null> {
  const email = user.email ?? "";
  await ensureUserDoc(user.uid, email, user.displayName, user.photoURL);
  // Confirming happens in whatever tab the mail client opened, so a session
  // that started before the click still carries a token saying otherwise. One
  // reload for the unconfirmed — never for the rest, who are the common case
  // and would be paying a round trip for nothing.
  if (!user.emailVerified) await user.reload().catch(() => {});
  if (email && user.emailVerified) await resolvePendingInvites(user.uid, email);
  const snap = await getDoc(doc(db, "users", user.uid));
  return snap.exists() ? (snap.data() as UserDoc) : null;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  firebaseUser: null,
  userDoc: null,
  initializing: true,
  bootstrapping: false,
  emailVerified: false,
  error: null,

  init: () => {
    return onAuthStateChanged(auth, async (user) => {
      set({ firebaseUser: user, initializing: false, emailVerified: !!user?.emailVerified });
      if (!user) {
        set({ userDoc: null });
        return;
      }
      set({ bootstrapping: true });
      try {
        const userDoc = await bootstrap(user);
        // bootstrap() may have reloaded the user; publish what it found.
        set({ userDoc, bootstrapping: false, emailVerified: user.emailVerified });
        // Resolution order: localStorage override → userDoc.language → browser.
        // syncFromUserDoc is a no-op if a local override is already set.
        useI18nStore.getState().syncFromUserDoc(isLang(userDoc?.language) ? userDoc.language : null);
      } catch (err) {
        set({ error: (err as Error).message, bootstrapping: false });
      }
    });
  },

  signInWithGoogle: async () => {
    set({ error: null });
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  signInWithEmail: async (email, password) => {
    set({ error: null });
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  registerWithEmail: async (email, password, displayName) => {
    set({ error: null });
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      // Accepting an emailed invitation requires a verified address, so the
      // confirmation has to be offered at the one moment the user is definitely
      // paying attention. Best effort: a failure here must not fail the signup
      // they just completed — `resendVerification` is the way back.
      await sendEmailVerification(cred.user).catch(() => {});
      if (displayName.trim()) {
        await updateProfile(cred.user, { displayName: displayName.trim() });
      }
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  saveProfile: async (patch) => {
    const { firebaseUser, userDoc } = get();
    if (!firebaseUser) throw new Error("Not signed in.");
    await updateUserProfile(firebaseUser.uid, patch);
    if (userDoc) set({ userDoc: { ...userDoc, ...patch } });
  },

  resendVerification: async () => {
    const user = auth.currentUser;
    if (!user || user.emailVerified) return false;
    try {
      await sendEmailVerification(user);
      return true;
    } catch {
      return false;
    }
  },

  recheckVerification: async () => {
    const user = auth.currentUser;
    if (!user) return false;
    await user.reload().catch(() => {});
    if (!user.emailVerified) {
      set({ emailVerified: false });
      return false;
    }
    // The rules read the claim in the token, not the account record, so the
    // sweep below would still be denied without this.
    await user.getIdToken(true).catch(() => {});
    set({ emailVerified: true });
    if (user.email) await resolvePendingInvites(user.uid, user.email).catch(() => 0);
    return true;
  },

  signOutUser: async () => {
    await signOut(auth);
  },
}));
