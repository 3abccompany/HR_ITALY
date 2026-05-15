
import { NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import { executeSubmissionTransaction } from "@/services/application-submission.service";
import { AttachmentMetadata } from "@/types/application-submission";

/**
 * Safer check for missing required values.
 * Accepts 0 and false as valid values.
 */
function isMissingRequiredValue(value: unknown) {
  return value === undefined || value === null || value === "";
}

export async function POST(request: Request) {
  // Generate a stable submissionId to be used across Storage and Firestore
  const submissionId = adminDb.collection("_temp_").doc().id;
  const uploadedFiles: string[] = [];

  console.log(`[PUBLIC SUBMIT] Start processing submission: ${submissionId}`);

  try {
    const formData = await request.formData();
    const publicSlug = formData.get("publicSlug") as string;
    const answersStr = formData.get("answers") as string;
    const answers = answersStr ? JSON.parse(answersStr) : {};

    if (!publicSlug) {
      return NextResponse.json({ error: { message: "Identifiant de l'offre manquant." } }, { status: 400 });
    }

    // 1. Fetch Form Details using Admin SDK (Collection Group Query)
    // Requires Index: collectionGroup: applicationForms, fields: publicSlug (ASC), status (ASC)
    const formSnap = await adminDb.collectionGroup("applicationForms")
      .where("publicSlug", "==", publicSlug)
      .where("status", "==", "published")
      .limit(1)
      .get();

    if (formSnap.empty) {
      console.error(`[PUBLIC SUBMIT] No published form found for slug: ${publicSlug}`);
      return NextResponse.json({ error: { message: "Désolé, cette offre n'est plus disponible." } }, { status: 404 });
    }

    const formDoc = formSnap.docs[0];
    const form = formDoc.data();
    const entityId = form.entityId;

    console.log(`[PUBLIC SUBMIT] Form loaded: ${form.formId} for entity: ${entityId}`);

    // 2. Server-side Validation of Required Fields
    const enabledFields = (form.fields || []).filter((f: any) => f.enabled !== false);
    for (const field of enabledFields) {
      const val = answers[field.key];
      
      if (field.required) {
        // Special case for consent or mandatory checkboxes (must be true)
        if (field.type === "checkbox" || field.key === "consent") {
          if (val !== true) {
            return NextResponse.json({ error: { message: `Veuillez accepter : ${field.label}` } }, { status: 400 });
          }
        } 
        // File validation
        else if (field.type === "file") {
          const file = formData.get(field.key);
          if (!file || (file instanceof File && file.size === 0)) {
            return NextResponse.json({ error: { message: `Le fichier "${field.label}" est obligatoire.` } }, { status: 400 });
          }
        } 
        // Standard text/number/select validation
        else if (isMissingRequiredValue(val)) {
          return NextResponse.json({ error: { message: `Le champ "${field.label}" est obligatoire.` } }, { status: 400 });
        }
      }
    }

    console.log(`[PUBLIC SUBMIT] Validation passed. Processing files...`);

    // 3. Process and Upload Attachments
    const attachments: AttachmentMetadata[] = [];
    const bucket = adminStorage.bucket();
    const fileFields = ["cv", "coverLetter"];

    for (const type of fileFields) {
      const file = formData.get(type) as File | null;
      if (file && file.size > 0) {
        const attachmentId = adminDb.collection("_temp_").doc().id;
        const safeName = file.name.replace(/[^a-z0-9.]/gi, "_").toLowerCase();
        const filePath = `entities/${entityId}/applicationSubmissions/${submissionId}/attachments/${attachmentId}-${safeName}`;
        
        const buffer = Buffer.from(await file.arrayBuffer());
        await bucket.file(filePath).save(buffer, {
          metadata: { contentType: file.type }
        });
        
        uploadedFiles.push(filePath);
        console.log(`[PUBLIC SUBMIT] Uploaded: ${filePath}`);

        attachments.push({
          id: attachmentId,
          type: type === "cv" ? "cv" : "cover_letter",
          fileName: file.name,
          filePath: filePath,
          mimeType: file.type,
          size: file.size,
          uploadedAt: new Date().toISOString()
        });
      }
    }

    // 4. Save Record to Firestore using atomic transaction
    console.log(`[PUBLIC SUBMIT] Executing transaction for submission: ${submissionId}`);
    await executeSubmissionTransaction(entityId, form, answers, attachments, submissionId);

    console.log(`[PUBLIC SUBMIT] Successfully completed submission: ${submissionId}`);
    return NextResponse.json({ success: true, submissionId });

  } catch (error: any) {
    console.error("[PUBLIC SUBMIT CRITICAL ERROR]", error);

    // Cleanup: Remove orphaned files if the transaction failed
    if (uploadedFiles.length > 0) {
      const bucket = adminStorage.bucket();
      console.log(`[PUBLIC SUBMIT] Cleaning up ${uploadedFiles.length} files...`);
      for (const path of uploadedFiles) {
        await bucket.file(path).delete().catch(e => console.warn(`[CLEANUP ERROR] Failed to delete ${path}`, e));
      }
    }

    const isDuplicate = error.message === "ALREADY_APPLIED_TO_THIS_JOB";
    const status = isDuplicate ? 400 : 500;
    const message = isDuplicate 
      ? "Vous avez déjà postulé à ce poste." 
      : "Une erreur est survenue lors de l'envoi de votre candidature. Veuillez réessayer.";

    return NextResponse.json(
      { 
        error: { 
          message, 
          code: isDuplicate ? "ALREADY_APPLIED_TO_THIS_JOB" : "INTERNAL_ERROR",
          technicalMessage: process.env.NODE_ENV === 'development' ? error.message : undefined
        } 
      }, 
      { status }
    );
  }
}
