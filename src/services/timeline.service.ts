import { db } from "@/lib/firebase/client";
import { collection, doc, setDoc, serverTimestamp } from "firebase/firestore";

export interface TimelineEventInput {
  entityId: string;
  personId: string;
  type: string;
  title: string;
  description?: string;
  data?: any;
  createdBy: string;
}

export async function createPersonTimelineEvent(input: TimelineEventInput) {
  const timelineRef = doc(collection(db, `entities/${input.entityId}/personTimeline`));
  await setDoc(timelineRef, {
    ...input,
    timestamp: serverTimestamp(),
  });
}