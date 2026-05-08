import { FieldValue } from "firebase/firestore";

export interface PersonTimelineEvent {
  eventId: string;
  entityId: string;
  personId: string;
  type: string;
  label: string;
  description: string;
  sourceCollection: string;
  sourceId: string;
  createdAt: Date | FieldValue;
  createdBy: string;
  metadata?: any;
}
