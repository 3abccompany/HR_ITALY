
'use client';

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { firebaseConfig } from './config';

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

const isConfigValid = 
  firebaseConfig.apiKey && 
  firebaseConfig.apiKey !== 'placeholder-key' &&
  firebaseConfig.projectId &&
  firebaseConfig.projectId !== '';

export function initializeFirebase() {
  try {
    if (!getApps().length) {
      app = initializeApp(firebaseConfig);
    } else {
      app = getApps()[0];
    }
    
    if (app && isConfigValid) {
      auth = getAuth(app);
      db = getFirestore(app);
    } else {
      console.warn("Firebase configuration is missing or invalid. Authentication and Firestore will be unavailable.");
    }
  } catch (error) {
    console.error("Firebase initialization failed:", error);
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
