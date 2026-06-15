import { cert, getApps, initializeApp, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

/**
 * Initializes the Firebase Admin SDK using explicit service account credentials.
 * This is required for server-side operations (API routes/Server Actions).
 * Returns null if credentials are missing to avoid blocking Next.js build time.
 */
function getAdminApp(): App | null {
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
    // Build-time safety: don't throw if credentials are missing.
    // Next.js executes this module during "Collecting page data".
    if (typeof window === 'undefined' && process.env.NODE_ENV !== 'production') {
      console.warn("[Admin SDK] Initialization skipped: Missing credentials in environment.");
    }
    return null;
  }

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

// Guarded service initializations to prevent build-time crashes
export const adminDb = adminApp ? getFirestore(adminApp) : (null as unknown as Firestore);
export const adminAuth = adminApp ? getAuth(adminApp) : (null as unknown as Auth);
export const adminStorage = adminApp ? getStorage(adminApp) : null;

// Explicitly export the bucket with validation
const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
export const adminBucket = adminStorage ? adminStorage.bucket(bucketName) : (null as any);
