import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  connectAuthEmulator,
} from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

if (!firebaseConfig.projectId) {
  throw new Error(
    "Missing Firebase config. Copy .env.example to .env.local and fill in your Firebase web app config.",
  );
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
/**
 * Firestore with an on-disk cache, rather than the in-memory default.
 *
 * What this buys: a Pulse opens from IndexedDB while the network catches up,
 * and — the reason it was turned on — edits made offline survive a reload
 * instead of evaporating with the tab. The memory-only default queued unsent
 * writes in the tab that made them, so closing it lost the work silently.
 *
 * `persistentMultipleTabManager` is not optional here. With the single-tab
 * manager the *first* tab takes the persistence lease and every other one
 * fails to acquire it — and people keep two Pulses open side by side, which is
 * the whole point of a roadmap tool.
 *
 * `initializeFirestore` rather than `getFirestore`: the cache can only be
 * chosen at creation, and this module is the single place the instance comes
 * from, so it happens before anything can touch it. Where IndexedDB is
 * unavailable — private windows, storage denied, older browsers — the SDK
 * falls back to the memory cache on its own and logs; the app keeps working
 * with exactly the behaviour it had before this change.
 *
 * The cost is that this device now holds a copy of everything the signed-in
 * user can read, and it outlives the session. `signOutUser` clears it (see
 * authStore) — persistence without that would leave one person's workspace
 * readable on a shared machine after they had left.
 */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
// Must match conventions.REGION in functions/ — a callable invoked against the
// wrong region 404s rather than falling back.
export const functions = getFunctions(app, "us-central1");
export const googleProvider = new GoogleAuthProvider();

// Point the SDK at local emulators during development when explicitly
// requested — avoids touching the real project while iterating.
if (import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
