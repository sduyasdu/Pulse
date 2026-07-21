import { create } from "zustand";
import {
  createUserWithEmailAndPassword,
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
import { ensureUserDoc, resolvePendingInvites } from "@/services/firestore/users";

interface AuthState {
  firebaseUser: FirebaseUser | null;
  userDoc: UserDoc | null;
  /** True until the very first onAuthStateChanged callback has fired. */
  initializing: boolean;
  /** True while the post-sign-in bootstrap (user doc + invite resolution)
   * is in flight — the dashboard should wait for this before querying
   * myPulses, since a freshly-accepted invite might not be indexed yet. */
  bootstrapping: boolean;
  error: string | null;
  init: () => () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
  signOutUser: () => Promise<void>;
}

async function bootstrap(user: FirebaseUser): Promise<UserDoc | null> {
  const email = user.email ?? "";
  await ensureUserDoc(user.uid, email, user.displayName, user.photoURL);
  if (email) await resolvePendingInvites(user.uid, email);
  const snap = await getDoc(doc(db, "users", user.uid));
  return snap.exists() ? (snap.data() as UserDoc) : null;
}

export const useAuthStore = create<AuthState>((set) => ({
  firebaseUser: null,
  userDoc: null,
  initializing: true,
  bootstrapping: false,
  error: null,

  init: () => {
    return onAuthStateChanged(auth, async (user) => {
      set({ firebaseUser: user, initializing: false });
      if (!user) {
        set({ userDoc: null });
        return;
      }
      set({ bootstrapping: true });
      try {
        const userDoc = await bootstrap(user);
        set({ userDoc, bootstrapping: false });
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
      if (displayName.trim()) {
        await updateProfile(cred.user, { displayName: displayName.trim() });
      }
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  signOutUser: async () => {
    await signOut(auth);
  },
}));
