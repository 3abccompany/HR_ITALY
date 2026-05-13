import { getApps, initializeApp, App, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

let adminApp: App;

if (!getApps().length) {
  adminApp = initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
} else {
  adminApp = getApps()[0];
}

export const adminDb = getFirestore(adminApp);
