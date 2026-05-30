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
    currentCandidateId: null,
    currentEmployeeId: null,
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
 * Updates a person's details and propagates current identity/contact changes
 * to linked active Candidate and Employee records while preserving historical snapshots.
 */
export async function updatePerson(entityId: string, personId: string, data: Partial<Person>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const personRef = doc(db, `entities/${entityId}/persons`, personId);
  const personSnap = await getDoc(personRef);
  if (!personSnap.exists()) throw new Error("Fiche personne introuvable.");
  const current = personSnap.data() as Person;

  // 1. Uniqueness Checks for Email and Tax Code within the entity
  if (data.email && data.email !== current.email) {
    const q = query(collection(db, `entities/${entityId}/persons`), where("email", "==", data.email));
    const snap = await getDocs(q);
    if (!snap.empty) throw new Error("Cette adresse email est déjà associée à une autre personne dans cette entreprise.");
  }
  
  if (data.codiceFiscale && data.codiceFiscale !== current.codiceFiscale) {
    const q = query(collection(db, `entities/${entityId}/persons`), where("codiceFiscale", "==", data.codiceFiscale));
    const snap = await getDocs(q);
    if (!snap.empty) throw new Error("Ce code fiscal est déjà associé à une autre personne dans cette entreprise.");
  }

  const batch = writeBatch(db);

  // 2. Update the Person document
  batch.update(personRef, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  // 3. Propagation Detection
  const identityFields = ["firstName", "lastName", "displayName", "email", "phone", "codiceFiscale", "dateOfBirth"];
  const hasIdentityChanges = identityFields.some(f => data[f as keyof Person] !== undefined && data[f as keyof Person] !== current[f as keyof Person]);

  let candidatesCount = 0;
  let employeesCount = 0;
  let viewsCount = 0;

  if (hasIdentityChanges) {
    // 4. Propagate to Candidates (Display/Contact fields)
    const candQ = query(collection(db, `entities/${entityId}/candidates`), where("personId", "==", personId));
    const candSnap = await getDocs(candQ);
    candSnap.docs.forEach(d => {
      batch.update(d.ref, {
        ...(data.displayName && { displayName: data.displayName }),
        ...(data.email && { email: data.email }),
        ...(data.phone && { phone: data.phone }),
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      });
      candidatesCount++;

      // Update View (Denormalized display data)
      const vRef = doc(db, `entities/${entityId}/candidateViews`, d.id);
      batch.set(vRef, {
        ...(data.displayName && { displayName: data.displayName }),
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      }, { merge: true });
      viewsCount++;
    });

    // 5. Propagate to Employees (Display/Contact/Identity fields)
    const empQ = query(collection(db, `entities/${entityId}/employees`), where("personId", "==", personId));
    const empSnap = await getDocs(empQ);
    empSnap.docs.forEach(d => {
      batch.update(d.ref, {
        ...(data.firstName && { firstName: data.firstName }),
        ...(data.lastName && { lastName: data.lastName }),
        ...(data.displayName && { displayName: data.displayName }),
        ...(data.email && { email: data.email }),
        ...(data.phone && { phone: data.phone }),
        ...(data.codiceFiscale && { taxCode: data.codiceFiscale }),
        ...(data.dateOfBirth && { birthDate: data.dateOfBirth }),
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      });
      employeesCount++;

      // Update View (Denormalized display data)
      const vRef = doc(db, `entities/${entityId}/employeeViews`, d.id);
      batch.set(vRef, {
        ...(data.displayName && { displayName: data.displayName }),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      viewsCount++;
    });
  }

  await batch.commit();

  try {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "person.updated",
      resourceType: "person",
      resourceId: personId,
      details: { 
        changedFields: Object.keys(data),
        propagation: { candidatesCount, employeesCount, viewsCount }
      }
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

  try {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "person.reactivated",
      resourceType: "person",
      resourceId: personId,
    });
  } catch (auditErr) {
    console.warn("Failed to write audit log for person reactivation:", auditErr);
  }
}
