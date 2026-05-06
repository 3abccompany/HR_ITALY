
'use client';

import { initializeFirebase } from '@/firebase';

const { auth, db } = initializeFirebase();

export { auth, db };
// Storage is not initialized in the default scaffolding but can be added if needed.
// For now, we use the standard db and auth.
export const storage = null as any; 
