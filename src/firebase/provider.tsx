
'use client';

import React, { createContext, useContext } from 'react';
import { FirebaseApp } from 'firebase/app';
import { Auth } from 'firebase/auth';
import { Firestore } from 'firebase/firestore';

interface FirebaseContextType {
  app: FirebaseApp | undefined;
  auth: Auth | undefined;
  db: Firestore | undefined;
  missingVars: string[];
}

const FirebaseContext = createContext<FirebaseContextType | undefined>(undefined);

export function FirebaseProvider({
  children,
  app,
  auth,
  db,
  missingVars = [],
}: {
  children: React.ReactNode;
  app: FirebaseApp | undefined;
  auth: Auth | undefined;
  db: Firestore | undefined;
  missingVars?: string[];
}) {
  return (
    <FirebaseContext.Provider value={{ app, auth, db, missingVars }}>
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebase() {
  const context = useContext(FirebaseContext);
  if (!context) throw new Error('useFirebase must be used within a FirebaseProvider');
  return context;
}

export function useFirebaseApp() {
  const app = useFirebase().app;
  if (!app) throw new Error('Firebase App is not initialized.');
  return app;
}

export function useAuth() {
  const auth = useFirebase().auth;
  if (!auth) throw new Error('Firebase Auth is not initialized. Check your configuration.');
  return auth;
}

export function useFirestore() {
  const db = useFirebase().db;
  if (!db) throw new Error('Firestore is not initialized. Check your configuration.');
  return db;
}
