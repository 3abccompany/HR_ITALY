import { cert, getApps, initializeApp, App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

/**
 * Initializes the Firebase Admin SDK using explicit service account credentials.
 * This is required for server-side operations (API routes/Server Actions)
 * when running in environments like Firebase Studio or local dev.
 */
function getAdminApp(): App {
  const existingApps = getApps();
  if (existingApps.length > 0) {
    return existingApps[0];
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Handle newlines in private key which are often escaped in env vars
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

  if (!projectId || !clientEmail || !privateKey) {
    console.error("[Admin SDK] Missing required credentials. Check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.");
    throw new Error(
      "Missing Firebase Admin credentials. Please set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in your environment."
    );
  }

  console.log(`[Admin SDK] Initializing for project: ${projectId}`);
  
  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
    projectId,
    storageBucket,
  });
}

export const adminApp = getAdminApp();
export const adminDb = getFirestore(adminApp);
export const adminAuth = getAuth(adminApp);
export const adminStorage = getStorage(adminApp);

// Explicitly export the bucket with validation
const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
if (!bucketName && typeof window === 'undefined') {
  console.warn("[Admin SDK] FIREBASE_STORAGE_BUCKET environment variable is not set. Storage operations will fail.");
}
export const adminBucket = adminStorage.bucket(bucketName);
