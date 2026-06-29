import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  query, 
  where, 
  orderBy, 
  serverTimestamp, 
  writeBatch,
  getDocs,
  or,
  limit
} from "firebase/firestore";
import { Notification, NotificationStatus } from "@/types/notification";

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
 */
export async function markAllNotificationsAsRead(entityId: string, uid: string, permissions: string[]) {
  if (!db) return;

  const notificationsRef = collection(db, `entities/${entityId}/notifications`);
  
  // We fetch unread notifications targeted at this user
  const q = query(
    notificationsRef,
    where("status", "==", "unread"),
    or(
      where("targetUid", "==", uid),
      where("targetPermission", "in", permissions.length > 0 ? permissions : ["__none__"])
    )
  );

  const snap = await getDocs(q);
  if (snap.empty) return;

  const batch = writeBatch(db);
  const now = serverTimestamp();

  snap.docs.forEach(d => {
    batch.update(d.ref, {
      status: "read",
      readAt: now
    });
  });

  await batch.commit();
}
