import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
} from "firebase/firestore";
import {
  deleteObject,
  getBytes,
  ref,
  uploadBytes,
} from "firebase/storage";

const PROJECT_ID = "demo-hr-italy";
const ENTITY_A = "entity-a";
const ENTITY_B = "entity-b";
const TEN_MIB = 10 * 1024 * 1024;

let testEnv;

const textBlob = (content, type = "application/pdf") => new Blob([content], { type });
const sizedBlob = (size, type = "application/pdf") => new Blob([new Uint8Array(size)], { type });

const path = {
  application: "entities/entity-a/applicationSubmissions/submission-a/cv.pdf",
  unknown: "entities/entity-a/unclassified/file.pdf",
  rootUnknown: "misc/file.pdf",
  ownDoc: "entities/entity-a/documents/document-a/file.pdf",
  otherDoc: "entities/entity-a/documents/document-b/file.pdf",
  sensitiveDoc: "entities/entity-a/documents/sensitive-document-a/file.pdf",
  missingSensitiveDoc: "entities/entity-a/documents/missing-sensitive-field/file.pdf",
  malformedSensitiveDoc: "entities/entity-a/documents/malformed-sensitive-field/file.pdf",
  missingEmployeeDoc: "entities/entity-a/documents/missing-employee/file.pdf",
  missingMetadataDoc: "entities/entity-a/documents/missing-metadata/file.pdf",
  medicalDoc: "entities/entity-a/documents/medical-document/file.pdf",
  payrollDoc: "entities/entity-a/documents/payroll-document/file.pdf",
  safetyDoc: "entities/entity-a/documents/safety-document/file.pdf",
  trainingDoc: "entities/entity-a/documents/training-document/file.pdf",
  prehireDoc: "entities/entity-a/documents/prehire-document/file.pdf",
  entityBDoc: "entities/entity-b/documents/entity-b-document/file.pdf",
  generatedContractA: "entities/entity-a/contracts/contract-a/generated/contract.pdf",
  generatedContractB: "entities/entity-a/contracts/contract-b/generated/contract.pdf",
  entityBGeneratedContract: "entities/entity-b/contracts/entity-b-contract/generated/contract.pdf",
  signedContractA: "entities/entity-a/contracts/contract-a/signed-contract/signed.pdf",
  signedReturnB: "entities/entity-a/contracts/contract-b/signed-returns/return.pdf",
};

function authed(uid) {
  return testEnv.authenticatedContext(uid);
}

function unauthenticatedStorage() {
  return testEnv.unauthenticatedContext().storage();
}

async function seedFirestore() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, "users/employee-a"), { uid: "employee-a", status: "active", platformRole: "user" });
    await setDoc(doc(db, "users/employee-b"), { uid: "employee-b", status: "active", platformRole: "user" });
    await setDoc(doc(db, "users/hr-authorized"), { uid: "hr-authorized", status: "active", platformRole: "user" });
    await setDoc(doc(db, "users/hr-no-file"), { uid: "hr-no-file", status: "active", platformRole: "user" });
    await setDoc(doc(db, "users/ordinary-member"), { uid: "ordinary-member", status: "active", platformRole: "user" });
    await setDoc(doc(db, "users/inactive-membership-user"), { uid: "inactive-membership-user", status: "active", platformRole: "user" });
    await setDoc(doc(db, "users/inactive-employee-user"), { uid: "inactive-employee-user", status: "active", platformRole: "user" });
    await setDoc(doc(db, "users/entity-b-user"), { uid: "entity-b-user", status: "active", platformRole: "user" });
    await setDoc(doc(db, "users/safety-user"), { uid: "safety-user", status: "active", platformRole: "user" });
    await setDoc(doc(db, "users/training-user"), { uid: "training-user", status: "active", platformRole: "user" });
    await setDoc(doc(db, "users/platform-admin"), { uid: "platform-admin", status: "active", platformRole: "superAdmin" });
    await setDoc(doc(db, "users/inactive-platform-admin"), { uid: "inactive-platform-admin", status: "inactive", platformRole: "superAdmin" });

    await setDoc(doc(db, `entities/${ENTITY_A}`), { entityId: ENTITY_A, status: "active", name: "Entity A" });
    await setDoc(doc(db, `entities/${ENTITY_B}`), { entityId: ENTITY_B, status: "active", name: "Entity B" });

    const memberships = [
      ["employee-a_entity-a", "employee-a", ENTITY_A, ["self.leaves.create"]],
      ["employee-b_entity-a", "employee-b", ENTITY_A, ["self.leaves.create"]],
      ["hr-authorized_entity-a", "hr-authorized", ENTITY_A, ["documents.read", "documents.upload", "documents.archive", "contracts.read", "contracts.create", "contracts.update", "candidates.read", "leaveRequests.read", "medicalVisits.read", "training.read", "payroll.read", "safety.read"]],
      ["hr-no-file_entity-a", "hr-no-file", ENTITY_A, ["dashboard.read"]],
      ["ordinary-member_entity-a", "ordinary-member", ENTITY_A, ["dashboard.read"]],
      ["inactive-membership-user_entity-a", "inactive-membership-user", ENTITY_A, ["documents.read"]],
      ["inactive-employee-user_entity-a", "inactive-employee-user", ENTITY_A, ["self.leaves.create"]],
      ["entity-b-user_entity-b", "entity-b-user", ENTITY_B, ["documents.read", "documents.upload", "contracts.read", "contracts.create", "contracts.update"]],
      ["safety-user_entity-a", "safety-user", ENTITY_A, ["safety.read"]],
      ["training-user_entity-a", "training-user", ENTITY_A, ["training.read"]],
    ];

    for (const [id, uid, entityId, permissions] of memberships) {
      await setDoc(doc(db, `memberships/${id}`), {
        id,
        uid,
        userId: uid,
        entityId,
        status: id.startsWith("inactive-membership-user") ? "inactive" : "active",
        roleId: "test-role",
        permissions,
      });
    }

    await setDoc(doc(db, `entities/${ENTITY_A}/employees/employee-a-record`), {
      employeeId: "employee-a-record",
      entityId: ENTITY_A,
      userId: "employee-a",
      status: "active",
    });
    await setDoc(doc(db, `entities/${ENTITY_A}/employees/employee-b-record`), {
      employeeId: "employee-b-record",
      entityId: ENTITY_A,
      userId: "employee-b",
      status: "active",
    });
    await setDoc(doc(db, `entities/${ENTITY_A}/employees/inactive-employee-record`), {
      employeeId: "inactive-employee-record",
      entityId: ENTITY_A,
      userId: "inactive-employee-user",
      status: "terminated",
    });

    const documents = {
      "document-a": { employeeId: "employee-a-record", documentType: "other", relatedModule: "general", isSensitive: false },
      "document-b": { employeeId: "employee-b-record", documentType: "other", relatedModule: "general", isSensitive: false },
      "sensitive-document-a": { employeeId: "employee-a-record", documentType: "other", relatedModule: "general", isSensitive: true },
      "missing-sensitive-field": { employeeId: "employee-a-record", documentType: "other", relatedModule: "general" },
      "malformed-sensitive-field": { employeeId: "employee-a-record", documentType: "other", relatedModule: "general", isSensitive: "false" },
      "missing-employee": { documentType: "other", relatedModule: "general", isSensitive: false },
      "medical-document": { employeeId: "employee-a-record", documentType: "medical_certificate", relatedModule: "medicalVisits", isSensitive: true },
      "payroll-document": { employeeId: "employee-a-record", documentType: "payroll_document", relatedModule: "payroll", isSensitive: false },
      "safety-document": { employeeId: "employee-a-record", documentType: "dpi_delivery_report", relatedModule: "safety", isSensitive: false },
      "training-document": { employeeId: "employee-a-record", documentType: "training_certificate", relatedModule: "trainings", isSensitive: false },
      "prehire-document": { candidateId: "candidate-a", documentType: "prehire_required_document", relatedModule: "preHireDossiers", isSensitive: false },
    };

    for (const [documentId, data] of Object.entries(documents)) {
      await setDoc(doc(db, `entities/${ENTITY_A}/documents/${documentId}`), {
        id: documentId,
        entityId: ENTITY_A,
        status: "valid",
        storagePath: `entities/${ENTITY_A}/documents/${documentId}/file.pdf`,
        fileName: "file.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        ...data,
      });
    }

    await setDoc(doc(db, `entities/${ENTITY_B}/documents/entity-b-document`), {
      id: "entity-b-document",
      entityId: ENTITY_B,
      status: "valid",
      storagePath: path.entityBDoc,
      fileName: "file.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      documentType: "other",
      relatedModule: "general",
      isSensitive: false,
    });

    await setDoc(doc(db, `entities/${ENTITY_A}/contracts/contract-a`), {
      contractId: "contract-a",
      entityId: ENTITY_A,
      employeeId: "employee-a-record",
      status: "pending_signature",
    });
    await setDoc(doc(db, `entities/${ENTITY_A}/contracts/contract-b`), {
      contractId: "contract-b",
      entityId: ENTITY_A,
      employeeId: "employee-b-record",
      status: "pending_signature",
    });
    await setDoc(doc(db, `entities/${ENTITY_B}/contracts/entity-b-contract`), {
      contractId: "entity-b-contract",
      entityId: ENTITY_B,
      employeeId: "entity-b-employee-record",
      status: "pending_signature",
    });
  });
}

async function seedStorageObjects() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const storage = context.storage();
    await Promise.all(
      Object.values(path).map((storagePath) =>
        uploadBytes(ref(storage, storagePath), textBlob(`fixture:${storagePath}`))
      )
    );
  });
}

async function seedFixtures() {
  await seedFirestore();
  await seedStorageObjects();
}

function read(storage, storagePath) {
  return getBytes(ref(storage, storagePath));
}

function upload(storage, storagePath, blob = textBlob("upload")) {
  return uploadBytes(ref(storage, storagePath), blob);
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
    },
    storage: {
      rules: readFileSync("storage.rules", "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
  await seedFixtures();
});

after(async () => {
  await testEnv.cleanup();
});

describe("G1A Storage global containment", () => {
  test("denies unauthenticated and ordinary-member arbitrary entity access", async () => {
    await assertFails(read(unauthenticatedStorage(), path.ownDoc));
    await assertFails(upload(unauthenticatedStorage(), "entities/entity-a/documents/new-unauth/file.pdf"));

    const ordinaryStorage = authed("ordinary-member").storage();
    await assertFails(read(ordinaryStorage, path.ownDoc));
    await assertFails(upload(ordinaryStorage, "entities/entity-a/documents/new-ordinary/file.pdf"));
    await assertFails(read(ordinaryStorage, path.unknown));
    await assertFails(upload(ordinaryStorage, "entities/entity-a/unclassified/new.pdf"));
    await assertFails(read(ordinaryStorage, path.rootUnknown));
  });

  test("denies cross-entity access", async () => {
    const employeeAStorage = authed("employee-a").storage();
    const entityBStorage = authed("entity-b-user").storage();

    await assertFails(read(employeeAStorage, path.entityBDoc));
    await assertFails(upload(employeeAStorage, "entities/entity-b/documents/new-from-a/file.pdf"));
    await assertFails(read(entityBStorage, path.ownDoc));
    await assertFails(upload(entityBStorage, "entities/entity-a/documents/new-from-b/file.pdf"));
  });

  test("denies public application objects to direct clients", async () => {
    const hrStorage = authed("hr-authorized").storage();
    await assertFails(read(hrStorage, path.application));
    await assertFails(upload(hrStorage, "entities/entity-a/applicationSubmissions/submission-a/new.pdf"));
    await assertFails(upload(hrStorage, path.application, textBlob("replace")));
    await assertFails(deleteObject(ref(hrStorage, path.application)));
  });
});

describe("G1A Storage employee isolation", () => {
  test("allows own explicitly authorized non-sensitive document and denies other employee files", async () => {
    const employeeAStorage = authed("employee-a").storage();
    const employeeBStorage = authed("employee-b").storage();

    await assertSucceeds(read(employeeAStorage, path.ownDoc));
    await assertFails(read(employeeAStorage, path.otherDoc));
    await assertFails(upload(employeeAStorage, "entities/entity-a/documents/document-b/evil.pdf"));
    await assertFails(read(employeeBStorage, path.ownDoc));
  });

  test("denies inactive membership, inactive employee, missing ownership, and missing metadata", async () => {
    await assertFails(read(authed("inactive-membership-user").storage(), path.ownDoc));
    await assertFails(read(authed("inactive-employee-user").storage(), path.ownDoc));
    await assertFails(read(authed("employee-a").storage(), path.missingEmployeeDoc));
    await assertFails(read(authed("employee-a").storage(), path.missingMetadataDoc));
  });

  test("denies sensitive, missing-sensitive, malformed-sensitive, medical, and payroll direct self reads", async () => {
    const employeeAStorage = authed("employee-a").storage();

    await assertFails(read(employeeAStorage, path.sensitiveDoc));
    await assertFails(read(employeeAStorage, path.missingSensitiveDoc));
    await assertFails(read(employeeAStorage, path.malformedSensitiveDoc));
    await assertFails(read(employeeAStorage, path.medicalDoc));
    await assertFails(read(employeeAStorage, path.payrollDoc));
  });

  test("allows own contract reads where direct contract reads are explicitly permitted and denies other contracts", async () => {
    const employeeAStorage = authed("employee-a").storage();

    await assertSucceeds(read(employeeAStorage, path.generatedContractA));
    await assertSucceeds(read(employeeAStorage, path.signedContractA));
    await assertFails(read(employeeAStorage, path.generatedContractB));
    await assertFails(upload(employeeAStorage, "entities/entity-a/contracts/contract-a/generated/new.pdf"));
    await assertFails(upload(employeeAStorage, path.signedReturnB));
  });
});

describe("G1A Storage HR and module permissions", () => {
  test("allows authorized HR generic document upload/download and denies HR without file permission", async () => {
    const hrStorage = authed("hr-authorized").storage();
    const hrNoFileStorage = authed("hr-no-file").storage();

    await assertSucceeds(upload(hrStorage, "entities/entity-a/documents/new-hr-pdf/file.pdf", textBlob("pdf", "application/pdf")));
    await assertSucceeds(upload(hrStorage, "entities/entity-a/documents/new-hr-png/file.png", textBlob("png", "image/png")));
    await assertSucceeds(upload(hrStorage, "entities/entity-a/documents/new-hr-jpeg/file.jpg", textBlob("jpg", "image/jpeg")));
    await assertSucceeds(read(hrStorage, path.ownDoc));

    await assertFails(upload(hrNoFileStorage, "entities/entity-a/documents/no-file/file.pdf"));
    await assertFails(read(hrNoFileStorage, path.ownDoc));
  });

  test("allows authorized HR contract file access and denies unauthorized contract access", async () => {
    const hrStorage = authed("hr-authorized").storage();
    const ordinaryStorage = authed("ordinary-member").storage();

    await assertSucceeds(read(hrStorage, path.generatedContractA));
    await assertSucceeds(upload(hrStorage, "entities/entity-a/contracts/contract-a/signed-contract/hr-signed.pdf"));
    await assertSucceeds(read(hrStorage, path.signedContractA));
    await assertFails(read(ordinaryStorage, path.generatedContractA));
    await assertFails(upload(ordinaryStorage, "entities/entity-a/contracts/contract-a/signed-contract/evil.pdf"));
  });

  test("denies authorized HR cross-entity document and contract access", async () => {
    const hrStorage = authed("hr-authorized").storage();

    await assertFails(read(hrStorage, path.entityBDoc));
    await assertFails(upload(hrStorage, "entities/entity-b/documents/hr-cross-entity/file.pdf", textBlob("pdf", "application/pdf")));
    await assertFails(upload(hrStorage, path.entityBDoc, textBlob("overwrite", "application/pdf")));
    await assertFails(read(hrStorage, path.entityBGeneratedContract));
    await assertFails(upload(hrStorage, "entities/entity-b/contracts/entity-b-contract/signed-contract/hr-signed.pdf", textBlob("pdf", "application/pdf")));
  });

  test("checks Safety and Training permissions independently", async () => {
    await assertSucceeds(read(authed("safety-user").storage(), path.safetyDoc));
    await assertFails(read(authed("safety-user").storage(), path.trainingDoc));
    await assertSucceeds(read(authed("training-user").storage(), path.trainingDoc));
    await assertFails(read(authed("training-user").storage(), path.safetyDoc));
    await assertFails(read(authed("ordinary-member").storage(), path.safetyDoc));
    await assertFails(read(authed("ordinary-member").storage(), path.trainingDoc));
  });
});

describe("G1A Storage upload validation", () => {
  test("allows approved pre-hire PDF and image formats for authorized uploaders", async () => {
    const hrStorage = authed("hr-authorized").storage();

    await assertSucceeds(upload(hrStorage, "entities/entity-a/documents/prehire-pdf/file.pdf", textBlob("pdf", "application/pdf")));
    await assertSucceeds(upload(hrStorage, "entities/entity-a/documents/prehire-png/file.png", textBlob("png", "image/png")));
    await assertSucceeds(upload(hrStorage, "entities/entity-a/documents/prehire-jpg/file.jpg", textBlob("jpg", "image/jpeg")));
  });

  test("denies unsafe or unapproved upload types and sizes", async () => {
    const hrStorage = authed("hr-authorized").storage();

    await assertFails(upload(hrStorage, "entities/entity-a/documents/zero/file.pdf", sizedBlob(0, "application/pdf")));
    await assertFails(upload(hrStorage, "entities/entity-a/documents/limit/file.pdf", sizedBlob(TEN_MIB, "application/pdf")));
    await assertFails(upload(hrStorage, "entities/entity-a/documents/html/file.html", textBlob("<html></html>", "text/html")));
    await assertFails(upload(hrStorage, "entities/entity-a/documents/js/file.js", textBlob("alert(1)", "application/javascript")));
    await assertFails(upload(hrStorage, "entities/entity-a/documents/exe/file.exe", textBlob("MZ", "application/x-msdownload")));
    await assertFails(upload(hrStorage, "entities/entity-a/documents/zip/file.zip", textBlob("zip", "application/zip")));
    await assertFails(upload(hrStorage, "entities/entity-a/documents/doc/file.doc", textBlob("doc", "application/msword")));
    await assertFails(upload(hrStorage, "entities/entity-a/documents/docx/file.docx", textBlob("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")));
  });

  test("denies unauthorized overwrite and delete", async () => {
    const ordinaryStorage = authed("ordinary-member").storage();
    const hrStorage = authed("hr-authorized").storage();

    await assertFails(upload(ordinaryStorage, path.ownDoc, textBlob("overwrite")));
    await assertFails(deleteObject(ref(ordinaryStorage, path.ownDoc)));
    await assertFails(deleteObject(ref(hrStorage, path.ownDoc)));
  });
});

describe("G1A Storage platform administrator", () => {
  test("allows active platform admin on explicit paths and denies unknown paths", async () => {
    const platformStorage = authed("platform-admin").storage();

    await assertSucceeds(read(platformStorage, path.ownDoc));
    await assertSucceeds(read(platformStorage, path.generatedContractA));
    await assertFails(read(platformStorage, path.unknown));
  });

  test("denies inactive platform admin records", async () => {
    const inactivePlatformStorage = authed("inactive-platform-admin").storage();

    await assertFails(read(inactivePlatformStorage, path.ownDoc));
    await assertFails(upload(inactivePlatformStorage, "entities/entity-a/documents/platform-inactive/file.pdf"));
  });
});

describe("G1A Storage server-mediated path documentation", () => {
  test("documents server-mediated flows as direct-client denied where applicable", async () => {
    const employeeAStorage = authed("employee-a").storage();
    const hrStorage = authed("hr-authorized").storage();

    // These production flows use server/Admin SDK code paths. The client rule
    // stance remains denial for creation; server route authorization is tested
    // separately from Storage Rules.
    await assertFails(upload(hrStorage, "entities/entity-a/contracts/contract-a/generated/new.pdf"));
    await assertFails(upload(employeeAStorage, "entities/entity-a/contracts/contract-a/signed-returns/new.pdf"));
    await assertFails(upload(employeeAStorage, "entities/entity-a/documents/sickness-direct/file.pdf"));
    await assertFails(upload(hrStorage, "entities/entity-a/applicationSubmissions/submission-a/server-mediated.pdf"));
  });
});
