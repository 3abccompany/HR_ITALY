import { applicationDefault, cert, getApps, initializeApp, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

/**
 * Initializes the Firebase Admin SDK.
 * In Production (Firebase App Hosting / Cloud Run), it uses Application Default Credentials (ADC).
 * In Local Dev, it falls back to service account environment variables if provided.
 */
function getAdminApp(): App | null {
  const existingApps = getApps();
  if (existingApps.length > 0) {
    return existingApps[0];
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  try {
    // 1. If explicit credentials are provided (Local Dev / Legacy CI), use them.
    if (clientEmail && privateKey && !privateKey.includes("INVALID")) {
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

    // 2. Production / App Hosting: Use Application Default Credentials (ADC).
    // This removes the dependency on FIREBASE_PRIVATE_KEY in production.
    if (typeof window === 'undefined') {
      return initializeApp({
        credential: applicationDefault(),
        projectId,
        storageBucket,
      });
    }
  } catch (error: any) {
    // Build-time safety: return null if credentials are not available during static analysis.
    // Next.js executes this during "Collecting page data".
    if (typeof window === 'undefined' && process.env.NODE_ENV !== 'production') {
      console.warn("[Admin SDK] Lazy initialization skipped or failed:", error.message);
    }
  }

  return null;
}

export const adminApp = getAdminApp();

// Guarded service initializations to prevent crashes if Admin is not ready
export const adminDb = adminApp ? getFirestore(adminApp) : (null as unknown as Firestore);
export const adminAuth = adminApp ? getAuth(adminApp) : (null as unknown as Auth);
export const adminStorage = adminApp ? getStorage(adminApp) : null;

// Explicitly export the bucket with fallback resolution
const bucketName = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
export const adminBucket = adminStorage ? adminStorage.bucket(bucketName) : (null as any);
