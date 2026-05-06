import { db } from "@/lib/firebase/client";
import { collection, doc, getDoc, getDocs, query, where, setDoc, serverTimestamp } from "firebase/firestore";
import { Person } from "@/types/person";

export async function createPerson(input: Partial<Person> & { entityId: string; personId: string }) {
  const personRef = doc(db, `entities/${input.entityId}/persons`, input.personId);
  await setDoc(personRef, {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return input.personId;
}

export async function getPersonById(entityId: string, personId: string): Promise<Person | null> {
  const personDoc = await getDoc(doc(db, `entities/${entityId}/persons`, personId));
  return personDoc.exists() ? (personDoc.data() as Person) : null;
}

export async function getPersonsByEntityId(entityId: string): Promise<Person[]> {
  const snapshot = await getDocs(collection(db, `entities/${entityId}/persons`));
  return snapshot.docs.map(doc => doc.data() as Person);
}

export async function findPersonByTaxCode(entityId: string, taxCode: string): Promise<Person | null> {
  const q = query(
    collection(db, `entities/${entityId}/persons`),
    where("taxCode", "==", taxCode)
  );
  const snapshot = await getDocs(q);
  return snapshot.empty ? null : (snapshot.docs[0].data() as Person);
}