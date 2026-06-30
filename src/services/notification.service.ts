import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  query, 
  where, 
  serverTimestamp, 
  writeBatch,
  getDocs,
  Query
} from "firebase/firestore";
import { Notification } from "@/types/notification";

/**
 * Normalizes payload for Firestore.
 */
function sanitizePayload(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj.constructor?.name === 'FieldValue' || obj.constructor?.name === 'Timestamp' || obj._methodName === 'serverTimestamp') {
    return obj;
  }
  const newObj: any = Array.isArray(obj) ? [] : {};
  for (const key in obj) {
    const val = obj[key];
    if (val !== undefined) {
      newObj[key] = typeof val === 'object' ? sanitizePayload(val) : val;
    }
  }
  return newObj;
}

/**
 * Creates a new notification.
 * Use dedupKey to prevent duplicate alerts for the same business event.
 */
export async function createNotification(entityId: string, data: Partial<Notification>) {
  if (!db) throw new Error("Firestore not initialized");

  const notificationRef = doc(collection(db, `entities/${entityId}/notifications`));
  const id = notificationRef.id;

  const payload: Partial<Notification> = {
    ...data,
    id,
    entityId,
    status: "unread",
    createdAt: serverTimestamp(),
  };

  await setDoc(notificationRef, sanitizePayload(payload));
  return id;
}

/**
 * Marks a single notification as read.
 */
export async function markNotificationAsRead(entityId: string, notificationId: string) {
  if (!db) return;
  const ref = doc(db, `entities/${entityId}/notifications`, notificationId);
  await updateDoc(ref, {
    status: "read",
    readAt: serverTimestamp()
  });
}

/**
 * Archives a single notification.
 */
export async function archiveNotification(entityId: string, notificationId: string) {
  if (!db) return;
  const ref = doc(db, `entities/${entityId}/notifications`, notificationId);
  await updateDoc(ref, {
    status: "archived",
    archivedAt: serverTimestamp()
  });
}

/**
 * Marks all notifications visible to the current user as read.
 * Simplified queries to avoid composite index requirements.
 */
export async function markAllNotificationsAsRead(entityId: string, uid: string, permissions: string[]) {
  if (!db) return;

  const notificationsRef = collection(db, `entities/${entityId}/notifications`);
  
  // 1. Gather all required queries (Target only, no combined filters to avoid indexes)
  const allQueries: Query[] = [];
  
  // A. Target UID
  allQueries.push(query(
    notificationsRef,
    where("targetUid", "==", uid)
  ));

  // B. Target Permission (Chunked)
  if (permissions && permissions.length > 0) {
    const CHUNK_SIZE = 30;
    for (let i = 0; i < permissions.length; i += CHUNK_SIZE) {
      const chunk = permissions.slice(i, i + CHUNK_SIZE);
      allQueries.push(query(
        notificationsRef,
        where("targetPermission", "in", chunk)
      ));
    }
  }

  // 2. Fetch all snapshots in parallel
  const snapshots = await Promise.all(allQueries.map(q => getDocs(q)));

  // 3. Batch update deduplicated notifications with client-side status filter
  const batch = writeBatch(db);
  const now = serverTimestamp();
  const seenIds = new Set<string>();

  snapshots.forEach(snap => {
    snap.docs.forEach(d => {
      if (!seenIds.has(d.id)) {
        const data = d.data();
        if (data.status === "unread") {
          batch.update(d.ref, {
            status: "read",
            readAt: now
          });
        }
        seenIds.add(d.id);
      }
    });
  });

  if (seenIds.size > 0) {
    await batch.commit();
  }
}
