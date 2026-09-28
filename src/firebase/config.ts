/* ==========================================================================
   On the Road · Firebase config
   Replace with your actual Firebase project values.
   ========================================================================== */
import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);

// Persistent local cache: already-loaded trip data (legs, expenses, journal,
// etc.) reads offline, and writes queue locally and sync automatically once
// the connection returns. Multi-tab manager keeps two open tabs coherent
// instead of one silently falling back to memory-only cache.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// Firestore emulator (firebase.json only defines this one, port 8080 — auth
// and storage still hit real Firebase). Opt-in via VITE_USE_EMULATOR=true in
// .env.local so the default `npm run dev` keeps talking to the real project;
// this only ever runs in dev builds (import.meta.env.DEV), never a deployed
// build, as a second guard against a stray env var routing production traffic
// at localhost. Must connect before any other Firestore call — this file's
// exports are the first thing every store imports, so it's early enough.
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATOR === 'true') {
  connectFirestoreEmulator(db, 'localhost', 8080);
  // Confirms the connection actually took — a silent failure here means every
  // read and write quietly goes to production instead of the emulator.
  console.info('[firebase] Firestore -> emulator @ localhost:8080');
}

export const auth    = getAuth(app);
export const storage = getStorage(app);
