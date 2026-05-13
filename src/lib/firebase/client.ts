import { initializeFirebase } from '@/firebase';

const { auth, db, storage } = initializeFirebase();

export { auth, db, storage };
