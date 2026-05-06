
'use client';

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { firebaseConfig } from './config';

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

export function initializeFirebase() {
  try {
    if (!getApps().length) {
      app = initializeApp(firebaseConfig);
    } else {
      app = getApps()[0];
    }
    
    // Defensive initialization
    if (app && firebaseConfig.apiKey !== 'placeholder-key') {
      auth = getAuth(app);
      db = getFirestore(app);
    }
  } catch (error) {
    console.warn("Firebase initialization failed. Check your environment variables.", error);
  }

  return { 
    app: app as FirebaseApp, 
    auth: auth as Auth, 
    db: db as Firestore 
  };
}

export { FirebaseProvider, useFirebase, useFirebaseApp, useAuth, useFirestore } from './provider';
export { FirebaseClientProvider } from './client-provider';
export { useUser } from './auth/use-user';
export { useCollection } from './firestore/use-collection';
export { useDoc } from './firestore/use-doc';
