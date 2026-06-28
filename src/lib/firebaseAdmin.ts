import * as admin from "firebase-admin";

if (!admin.apps.length) {
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") {
    // Tell Admin SDK to look for emulator hosts
    process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
    process.env.FIREBASE_DATABASE_EMULATOR_HOST = "localhost:9000";
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";

    admin.initializeApp({
      projectId: "interact-deck",
      databaseURL: "http://localhost:9000?ns=interact-deck-default-rtdb",
    });
    console.log("Connected Admin SDK to Emulators");
  } else {
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || "{}")
      ),
      databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    });
  }
}

const adminDb = admin.firestore();
const adminAuth = admin.auth();
const adminRtdb = admin.database();
const adminStorage = admin.storage();

export { adminDb, adminAuth, adminRtdb, adminStorage };
