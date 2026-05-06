
'use client';

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { firebaseConfig } from './config';

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

export function initializeFirebase() {
  const missingVars = Object.entries(firebaseConfig)
    .filter(([_, value]) => !value || value === 'placeholder-key')
    .map(([key]) => `NEXT_PUBLIC_FIREBASE_${key.toUpperCase().replace(/[A-Z]/g, letter => `_${letter.toUpperCase()}`).replace('AUTH_DOMAIN', 'AUTH_DOMAIN').replace('PROJECT_ID', 'PROJECT_ID').replace('STORAGE_BUCKET', 'STORAGE_BUCKET').replace('MESSAGING_SENDER_ID', 'MESSAGING_SENDER_ID').replace('APP_ID', 'APP_ID')}`);
  
  // Custom mapping for exact env names if needed, but the simple replace above is close.
  // Let's just be explicit for the required ones:
  const exactMissing = [];
  if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) exactMissing.push('NEXT_PUBLIC_FIREBASE_API_KEY');
  if (!process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN) exactMissing.push('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN');
  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) exactMissing.push('NEXT_PUBLIC_FIREBASE_PROJECT_ID');
  if (!process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) exactMissing.push('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET');
  if (!process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID) exactMissing.push('NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID');
  if (!process.env.NEXT_PUBLIC_FIREBASE_APP_ID) exactMissing.push('NEXT_PUBLIC_FIREBASE_APP_ID');

  try {
    if (!getApps().length) {
      if (exactMissing.length === 0) {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
      }
    } else {
      app = getApps()[0];
      auth = getAuth(app);
      db = getFirestore(app);
    }
  } catch (error) {
    console.error("Firebase initialization failed:", error);
  }

  return { 
    app: app as FirebaseApp, 
    auth: auth as Auth, 
    db: db as Firestore,
    missingVars: exactMissing
  };
}

export { FirebaseProvider, useFirebase, useFirebaseApp, useAuth, useFirestore } from './provider';
export { FirebaseClientProvider } from './client-provider';
export { useUser } from './auth/use-user';
export { useCollection } from './firestore/use-collection';
export { useDoc } from './firestore/use-doc';
