import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  setDoc, 
  updateDoc, 
  serverTimestamp, 
  writeBatch 
} from "firebase/firestore";
import { Person, PersonStatus } from "@/types/person";
import { createAuditLog } from "./audit.service";

/**
 * Checks if a tax code is already used within the same entity.
 */
export async function findPersonByTaxCode(entityId: string, codiceFiscale: string): Promise<Person | null> {
  if (!db) return null;
  const q = query(
    collection(db, `entities/${entityId}/persons`),
    where("codiceFiscale", "==", codiceFiscale)
  );
  const snapshot = await getDocs(q);
  return snapshot.empty ? null : (snapshot.docs[0].data() as Person);
}

/**
 * Creates a new person with an initial timeline event.
 */
export async function createPerson(entityId: string, data: Partial<Person>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  // Uniqueness check
  if (data.codiceFiscale) {
    const existing = await findPersonByTaxCode(entityId, data.codiceFiscale);
    if (existing) throw new Error(`Le code fiscal ${data.codiceFiscale} est déjà utilisé dans cette entreprise.`);
  }

  const batch = writeBatch(db);
  const personRef = doc(collection(db, `entities/${entityId}/persons`));
  const personId = personRef.id;

  const personData: Person = {
    ...(data as any),
    personId,
    entityId,
    currentLifecycleStatus: "person",
    status: "active",
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  batch.set(personRef, personData);

  // Timeline Event
  const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
  batch.set(timelineRef, {
    eventId: timelineRef.id,
    entityId,
    personId,
    type: "person.created",
    label: "Personne créée",
    description: "Fiche identité initiale créée dans le système.",
    sourceCollection: "persons",
    sourceId: personId,
    createdAt: serverTimestamp(),
    createdBy: actorUid,
  });

  await batch.commit();

  try {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "person.created",
      resourceType: "person",
      resourceId: personId,
      details: { name: personData.displayName }
    });
  } catch (e) {
    console.warn("Audit log failed for person creation", e);
  }

  return personId;
}

/**
 * Updates a person's details.
 */
export async function updatePerson(entityId: string, personId: string, data: Partial<Person>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const personRef = doc(db, `entities/${entityId}/persons`, personId);
  
  await updateDoc(personRef, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  try {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "person.updated",
      resourceType: "person",
      resourceId: personId,
      details: data
    });
  } catch (e) {
    console.warn("Audit log failed for person update", e);
  }
}

/**
 * Disables a person record.
 */
export async function disablePerson(entityId: string, personId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const personRef = doc(db, `entities/${entityId}/persons`, personId);
  await updateDoc(personRef, {
    status: "inactive",
    disabledAt: serverTimestamp(),
    disabledBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "person.disabled",
    resourceType: "person",
    resourceId: personId,
  });
}

/**
 * Reactivates a person record.
 */
export async function reactivatePerson(entityId: string, personId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const personRef = doc(db, `entities/${entityId}/persons`, personId);
  await updateDoc(personRef, {
    status: "active",
    reactivatedAt: serverTimestamp(),
    reactivatedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "person.reactivated",
    resourceType: "person",
    resourceId: personId,
  });
}
