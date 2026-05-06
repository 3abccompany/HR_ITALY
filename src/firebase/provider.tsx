
'use client';

import React, { createContext, useContext } from 'react';
import { FirebaseApp } from 'firebase/app';
import { Auth } from 'firebase/auth';
import { Firestore } from 'firebase/firestore';

interface FirebaseContextType {
  app: FirebaseApp | undefined;
  auth: Auth | undefined;
  db: Firestore | undefined;
}

const FirebaseContext = createContext<FirebaseContextType | undefined>(undefined);

export function FirebaseProvider({
  children,
  app,
  auth,
  db,
}: {
  children: React.ReactNode;
  app: FirebaseApp | undefined;
  auth: Auth | undefined;
  db: Firestore | undefined;
}) {
  return (
    <FirebaseContext.Provider value={{ app, auth, db }}>
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
  return useFirebase().app!;
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
