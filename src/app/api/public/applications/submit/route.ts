import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminBucket } from "@/lib/firebase/admin";
import { executeSubmissionTransaction } from "@/services/application-submission.service";
import { AttachmentMetadata } from "@/types/application-submission";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PUBLIC_ATTACHMENT_SIZE = 5 * 1024 * 1024; // 5 MiB
const PUBLIC_ATTACHMENT_FIELDS = ["cv", "coverLetter"] as const;
const PUBLIC_ATTACHMENT_MIME_EXTENSIONS: Record<string, readonly string[]> = {
  "application/pdf": [".pdf"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
};

type PublicAttachmentField = (typeof PUBLIC_ATTACHMENT_FIELDS)[number];

class PublicUploadValidationError extends Error {
  constructor(
    public readonly code:
      | "FILE_TOO_LARGE"
      | "FILE_TYPE_NOT_ALLOWED"
      | "FILE_EXTENSION_MISMATCH"
      | "INVALID_FILE"
      | "TOO_MANY_FILES",
    message: string
  ) {
    super(message);
    this.name = "PublicUploadValidationError";
  }
}

function isPublicUploadValidationError(error: unknown): error is PublicUploadValidationError {
  return error instanceof PublicUploadValidationError;
}

function getAttachmentType(key: PublicAttachmentField): AttachmentMetadata["type"] {
  return key === "cv" ? "cv" : "cover_letter";
}

function sanitizeDisplayFileName(fileName: string) {
  const baseName = (fileName || "document")
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim() || "document";

  const normalized = baseName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);

  return normalized || "document";
}

function getLowercaseExtension(fileName: string) {
  const safeName = sanitizeDisplayFileName(fileName);
  const dotIndex = safeName.lastIndexOf(".");
  return dotIndex >= 0 ? safeName.slice(dotIndex).toLowerCase() : "";
}

function validatePublicAttachment(file: File, key: PublicAttachmentField) {
  if (!(file instanceof File) || !file.name || file.size <= 0) {
    throw new PublicUploadValidationError(
      "INVALID_FILE",
      `Le fichier ${key === "cv" ? "CV" : "lettre de motivation"} est invalide.`
    );
  }

  if (/[\\/]/.test(file.name)) {
    throw new PublicUploadValidationError(
      "INVALID_FILE",
      "Le nom du fichier contient des caractères non autorisés."
    );
  }

  if (file.size > MAX_PUBLIC_ATTACHMENT_SIZE) {
    throw new PublicUploadValidationError(
      "FILE_TOO_LARGE",
      `Le fichier ${key === "cv" ? "CV" : "lettre de motivation"} dépasse la taille maximale autorisée de 5 Mo.`
    );
  }

  const mimeType = file.type?.trim().toLowerCase();
  if (!mimeType || !(mimeType in PUBLIC_ATTACHMENT_MIME_EXTENSIONS)) {
    throw new PublicUploadValidationError(
      "FILE_TYPE_NOT_ALLOWED",
      "Format de fichier non supporté. Veuillez envoyer un fichier PDF, DOC ou DOCX."
    );
  }

  const extension = getLowercaseExtension(file.name);
  if (!PUBLIC_ATTACHMENT_MIME_EXTENSIONS[mimeType].includes(extension)) {
    throw new PublicUploadValidationError(
      "FILE_EXTENSION_MISMATCH",
      "L'extension du fichier ne correspond pas à son format. Veuillez envoyer un fichier PDF, DOC ou DOCX valide."
    );
  }

  return {
    mimeType,
    safeFileName: sanitizeDisplayFileName(file.name),
  };
}

async function cleanupUploadedPublicSubmissionFiles(uploadedPaths: string[]) {
  if (!adminBucket || uploadedPaths.length === 0) return;

  const cleanupResults = await Promise.allSettled(
    uploadedPaths.map((path) => adminBucket.file(path).delete({ ignoreNotFound: true }))
  );

  const failedCleanupCount = cleanupResults.filter((result) => result.status === "rejected").length;
  if (failedCleanupCount > 0) {
    console.warn("[Public Submission] Failed to clean up uploaded files after request failure.", {
      attemptedCount: uploadedPaths.length,
      failedCount: failedCleanupCount,
    });
  }
}

/**
 * POST /api/public/applications/submit
 * Public endpoint for candidate form submissions.
 * Handles multipart/form-data, file uploads to Storage, and atomic Firestore transactions.
 */
export async function POST(request: NextRequest) {
  // Guard for Admin SDK readiness (build-time safety)
  if (!adminDb || !adminBucket) {
    console.error("[Public Submission] Firebase Admin SDK not properly initialized or missing credentials.");
    return NextResponse.json(
      { success: false, error: "Le service de candidature est momentanément indisponible." }, 
      { status: 503 }
    );
  }

  const uploadedPaths: string[] = [];

  try {
    const formData = await request.formData();
    
    // Extract base parameters sent by PublicFormRenderer.tsx
    const publicSlug = formData.get("publicSlug") as string;
    const answersRaw = formData.get("answers") as string;

    if (!publicSlug || !answersRaw) {
      return NextResponse.json(
        { success: false, error: "Données de candidature incomplètes." }, 
        { status: 400 }
      );
    }

    let answers: Record<string, any>;
    try {
      answers = JSON.parse(answersRaw);
    } catch (e) {
      return NextResponse.json(
        { success: false, error: "Format de données invalide." }, 
        { status: 400 }
      );
    }

    // 1. Resolve Public Form Context Server-Side
    // We look up the form by slug across all entities to ensure it exists and is published.
    const formSnap = await adminDb
      .collectionGroup("applicationForms")
      .where("publicSlug", "==", publicSlug)
      .where("status", "==", "published")
      .limit(1)
      .get();

    if (formSnap.empty) {
      return NextResponse.json(
        { success: false, error: "Cette offre d'emploi n'est plus disponible ou a été clôturée." }, 
        { status: 404 }
      );
    }

    const formDoc = formSnap.docs[0];
    const form = formDoc.data();
    const entityId = form.entityId;

    // 2. Pre-generate submission ID for storage paths and database consistency
    const submissionRef = adminDb.collection("entities").doc(entityId).collection("applicationSubmissions").doc();
    const submissionId = submissionRef.id;

    // 3. Process File Attachments (CV, Cover Letter)
    const attachments: AttachmentMetadata[] = [];
    
    // Standard file keys used in the public form renderer
    for (const key of PUBLIC_ATTACHMENT_FIELDS) {
      const files = formData.getAll(key).filter((value): value is File => value instanceof File);

      if (files.length > 1) {
        throw new PublicUploadValidationError(
          "TOO_MANY_FILES",
          "Un seul fichier est autorisé par champ de pièce jointe."
        );
      }

      const file = files[0];
      if (!file) {
        const invalidValue = formData.get(key);
        if (invalidValue && !(invalidValue instanceof File)) {
          throw new PublicUploadValidationError(
            "INVALID_FILE",
            "La pièce jointe fournie est invalide."
          );
        }
        continue;
      }

      const type = getAttachmentType(key);
      const { mimeType, safeFileName } = validatePublicAttachment(file, key);
      const attachmentId = adminDb.collection("_").doc().id;
      const objectName = `${key}_${randomUUID()}_${safeFileName}`;
      const storagePath = `entities/${entityId}/applicationSubmissions/${submissionId}/${objectName}`;

      // Upload to Cloud Storage using Admin SDK
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      const bucketFile = adminBucket.file(storagePath);

      await bucketFile.save(fileBuffer, {
        contentType: mimeType,
        metadata: {
          metadata: {
            entityId,
            submissionId,
            formId: form.formId,
            type,
            origin: "public_submission"
          }
        }
      });
      uploadedPaths.push(storagePath);

      attachments.push({
        id: attachmentId, // Metadata entry ID
        type,
        fileName: safeFileName,
        filePath: storagePath,
        mimeType,
        size: file.size,
        uploadedAt: new Date().toISOString()
      });
    }

    // 4. Invoke Business Transaction
    // Handles deduplication, identity reconciliation (Person), and record creation.
    const result = await executeSubmissionTransaction(
      entityId,
      form,
      answers,
      attachments,
      submissionId
    );

    return NextResponse.json({ 
      success: true, 
      submissionId: result.submissionId 
    });

  } catch (err: any) {
    console.error("[Public Submission API] Failure:", err);

    await cleanupUploadedPublicSubmissionFiles(uploadedPaths);

    if (isPublicUploadValidationError(err)) {
      return NextResponse.json({
        success: false,
        error: {
          code: err.code,
          message: err.message,
        }
      }, { status: 400 });
    }

    // Business rule violations (Duplicate check or Identity conflict)
    if (err.message === "ALREADY_APPLIED_TO_THIS_JOB") {
      return NextResponse.json({ 
        success: false, 
        error: "Vous avez déjà postulé à cette offre d'emploi." 
      }, { status: 409 });
    }

    if (err.message?.includes("IDENTITY_CONFLICT")) {
      return NextResponse.json({ 
        success: false, 
        error: "Conflit d'identité. Cette adresse email appartient à un profil existant avec un nom différent. Veuillez vérifier vos informations." 
      }, { status: 409 });
    }

    // Generic fallback for unexpected errors
    return NextResponse.json({ 
      success: false, 
      error: "Une erreur est survenue lors du traitement de votre candidature. Veuillez réessayer plus tard." 
    }, { status: 500 });
  }
}
