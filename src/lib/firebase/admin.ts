import { cert, getApps, initializeApp, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';

/**
 * Initializes the Firebase Admin SDK using explicit service account credentials.
 * This prevents "Could not refresh access token" errors in environments where
 * default credentials are not available (like Firebase Studio or local workstations).
 */
function getAdminApp(): App {
  const existingApps = getApps();
  if (existingApps.length > 0) {
    return existingApps[0];
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Handle newlines in private key which are often escaped in env vars
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (projectId && clientEmail && privateKey) {
    console.log(`[Admin SDK] Initializing with explicit service account for project: ${projectId}`);
    return initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      projectId,
    });
  }

  // Fallback to project ID only if others are missing. 
  // Note: This may still fail with token errors if not running on GCP/Firebase infra.
  console.warn("[Admin SDK] FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY missing. Falling back to default credentials.");
  return initializeApp({
    projectId: projectId,
  });
}

export const adminApp = getAdminApp();
export const adminDb = getFirestore(adminApp);
export const adminAuth = getAuth(adminApp);
