
import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import { executeSubmissionTransaction } from "@/services/application-submission.service";
import { AttachmentMetadata } from "@/types/application-submission";

export const dynamic = 'force-dynamic';

function isMissingRequiredValue(value: unknown) {
  return value === undefined || value === null || value === "";
}

export async function POST(request: NextRequest) {
  console.log("[PUBLIC SUBMIT] Request received");
  let uploadedFiles: { path: string }[] = [];
  const submissionId = adminDb.collection("dummy").doc().id;

  try {
    const formData = await request.formData();
    console.log("[PUBLIC SUBMIT] FormData parsed");

    const publicSlug = formData.get("publicSlug") as string;
    const answersJson = formData.get("answers") as string;

    if (!publicSlug || !answersJson) {
      console.warn("[PUBLIC SUBMIT] Missing core parameters", { publicSlug, hasAnswers: !!answersJson });
      return NextResponse.json(
        { error: { message: "Paramètres manquants.", code: "MISSING_PARAMS" } },
        { status: 400 }
      );
    }

    const answers = JSON.parse(answersJson);
    console.log("[PUBLIC SUBMIT] Answers parsed", { keys: Object.keys(answers) });

    // 1. Fetch Form using Admin SDK
    console.log("[PUBLIC SUBMIT] Looking up form", { publicSlug });
    const formSnap = await adminDb
      .collectionGroup("applicationForms")
      .where("publicSlug", "==", publicSlug)
      .where("status", "==", "published")
      .limit(1)
      .get();

    if (formSnap.empty) {
      console.warn("[PUBLIC SUBMIT] Form not found or not published", { publicSlug });
      return NextResponse.json(
        { error: { message: "Cette offre n'est plus disponible.", code: "FORM_NOT_FOUND" } },
        { status: 404 }
      );
    }

    const formDoc = formSnap.docs[0];
    const form = formDoc.data();
    const entityId = form.entityId;
    console.log("[PUBLIC SUBMIT] Form found", { formId: form.formId, entityId });

    // 2. Server-side Validation
    for (const field of (form.fields || [])) {
      if (field.enabled === false) continue;

      if (field.type === 'file') {
        const file = formData.get(field.key);
        if (field.required && (!file || !(file instanceof File) || file.size === 0)) {
          return NextResponse.json(
            { error: { message: `Le document "${field.label}" est obligatoire.`, code: "VALIDATION_ERROR" } },
            { status: 400 }
          );
        }
        continue;
      }

      const val = answers[field.key];
      if (field.required && isMissingRequiredValue(val)) {
        return NextResponse.json(
          { error: { message: `Le champ "${field.label}" est obligatoire.`, code: "VALIDATION_ERROR" } },
          { status: 400 }
        );
      }

      // Consent must be true
      if (field.key === 'consent' && field.required && val !== true) {
        return NextResponse.json(
          { error: { message: "Vous devez accepter les conditions pour postuler.", code: "VALIDATION_ERROR" } },
          { status: 400 }
        );
      }
    }

    // 3. Process Files
    const attachments: AttachmentMetadata[] = [];
    const fileFields = ["cv", "coverLetter"];
    const bucket = adminStorage.bucket();

    for (const key of fileFields) {
      const file = formData.get(key) as File | null;
      if (file && file.size > 0) {
        console.log("[PUBLIC SUBMIT] Processing file", { key, name: file.name, size: file.size });
        const attachmentId = adminDb.collection("dummy").doc().id;
        const safeName = file.name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
        const filePath = `entities/${entityId}/applicationSubmissions/${submissionId}/attachments/${attachmentId}-${safeName}`;

        const buffer = Buffer.from(await file.arrayBuffer());
        await bucket.file(filePath).save(buffer, {
          metadata: { contentType: file.type }
        });

        uploadedFiles.push({ path: filePath });

        attachments.push({
          id: attachmentId,
          type: key as any,
          fileName: file.name,
          filePath,
          mimeType: file.type,
          size: file.size,
          uploadedAt: new Date().toISOString(),
        });
      }
    }

    // 4. Execute DB Transaction
    console.log("[PUBLIC SUBMIT] Executing transaction", { submissionId });
    await executeSubmissionTransaction(entityId, form, answers, attachments, submissionId);
    console.log("[PUBLIC SUBMIT] Success", { submissionId });

    return NextResponse.json({ success: true, submissionId });

  } catch (error: any) {
    console.error("[PUBLIC SUBMIT] Critical failure", error);

    // Cleanup uploaded files on failure
    if (uploadedFiles.length > 0) {
      console.log("[PUBLIC SUBMIT] Cleaning up files after failure", { count: uploadedFiles.length });
      const bucket = adminStorage.bucket();
      for (const f of uploadedFiles) {
        await bucket.file(f.path).delete().catch(() => {});
      }
    }

    // Identify specific error types
    if (error.message === "ALREADY_APPLIED_TO_THIS_JOB") {
      return NextResponse.json(
        { error: { message: "Vous avez déjà postulé à ce poste.", code: "DUPLICATE_APPLICATION" } },
        { status: 400 }
      );
    }

    const debugMessage = process.env.NODE_ENV === 'development' ? (error.message || String(error)) : undefined;

    return NextResponse.json(
      { 
        error: { 
          message: "Une erreur est survenue lors de l'envoi de votre candidature. Veuillez réessayer.", 
          code: "INTERNAL_ERROR",
          debugMessage 
        } 
      },
      { status: 500 }
    );
  }
}
