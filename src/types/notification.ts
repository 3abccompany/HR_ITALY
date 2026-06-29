import { FieldValue } from "firebase/firestore";

export type NotificationStatus = "unread" | "read" | "archived";

export type NotificationSeverity = "info" | "warning" | "critical" | "success";

export type NotificationCategory = 
  | "contract" 
  | "cpi" 
  | "medical" 
  | "training" 
  | "safety" 
  | "absence" 
  | "document" 
  | "system";

export type NotificationAudience = "hr" | "employee" | "safety" | "admin";

export interface Notification {
  id: string;
  entityId: string;
  
  // Targeting
  targetUid?: string | null;
  targetPermission?: string | null;
  audience: NotificationAudience;
  
  // Content
  category: NotificationCategory;
  title: string;
  message: string;
  severity: NotificationSeverity;
  
  // Linkage
  sourceModule?: string | null;
  sourceId?: string | null;
  actionUrl?: string | null;
  
  // State
  status: NotificationStatus;
  dedupKey?: string | null;
  
  // Audit
  createdAt: Date | FieldValue;
  readAt?: Date | FieldValue | null;
  archivedAt?: Date | FieldValue | null;
}
