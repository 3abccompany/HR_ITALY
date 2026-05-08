import { db } from "@/lib/firebase/client";
import { collection, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { PersonTimelineEvent } from "@/types/timeline";

export async function createPersonTimelineEvent(
  entityId: string, 
  data: Omit<PersonTimelineEvent, 'eventId' | 'createdAt'>
) {
  if (!db) throw new Error("Firestore not initialized");

  const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
  const eventId = timelineRef.id;

  const event: PersonTimelineEvent = {
    ...data,
    eventId,
    createdAt: serverTimestamp(),
  };

  await setDoc(timelineRef, event);
  return eventId;
}
