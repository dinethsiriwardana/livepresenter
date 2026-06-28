import { initializeApp, getApps, getApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getStorage } from "firebase-admin/storage";

if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") {
  // Tell Admin SDK to look for emulator hosts
  process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = "localhost:9000";
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";
}

const app = getApps().length === 0
  ? initializeApp(
      process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true"
        ? {
            projectId: "interact-deck",
            databaseURL: "http://localhost:9000?ns=interact-deck-default-rtdb",
          }
        : {
            credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || "{}")),
            databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
          }
    )
  : getApp();

const adminDb = getFirestore(app);
const adminAuth = getAuth(app);
const adminRtdb = getDatabase(app);
const adminStorage = getStorage(app);

export { adminDb, adminAuth, adminRtdb, adminStorage };
