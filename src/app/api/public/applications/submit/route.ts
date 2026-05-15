import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminBucket } from "@/lib/firebase/admin";
import { executeSubmissionTransaction } from "@/services/application-submission.service";

export const dynamic = 'force-dynamic';

/**
 * Helper to identify missing required values (accepts 0 and false)
 */
function isMissingRequiredValue(value: unknown) {
  return value === undefined || value === null || value === "";
}

export async function POST(request: NextRequest) {
  const uploadedFiles: string[] = [];
  
  try {
    const formData = await request.formData();
    const publicSlug = formData.get("publicSlug")?.toString();
    const answersJson = formData.get("answers")?.toString();

    if (!publicSlug || !answersJson) {
      return NextResponse.json({ error: { message: "Paramètres manquants." } }, { status: 400 });
    }

    const answers = JSON.parse(answersJson);

    // 1. Fetch form using Admin SDK
    const formsSnap = await adminDb.collectionGroup("applicationForms")
      .where("publicSlug", "==", publicSlug)
      .where("status", "==", "published")
      .limit(1)
      .get();

    if (formsSnap.empty) {
      return NextResponse.json({ error: { message: "Offre introuvable ou fermée." } }, { status: 404 });
    }

    const formDoc = formsSnap.docs[0];
    const form = formDoc.data();
    const entityId = form.entityId;

    // 2. Server-side validation of required fields
    for (const field of (form.fields || [])) {
      if (field.enabled === false) continue;
      
      const val = answers[field.key];
      
      if (field.required) {
        // Special case for consent checkbox
        if (field.key === 'consent' || field.type === 'checkbox') {
          if (val !== true) {
            return NextResponse.json({ error: { message: `Vous devez accepter : ${field.label}` } }, { status: 400 });
          }
        } else if (field.type === 'file') {
          // File check happens later but we catch it here for logic consistency
          if (!formData.get(field.key)) {
            return NextResponse.json({ error: { message: `Le document ${field.label} est requis.` } }, { status: 400 });
          }
        } else if (isMissingRequiredValue(val)) {
          return NextResponse.json({ error: { message: `Le champ ${field.label} est obligatoire.` } }, { status: 400 });
        }
      }
    }

    // 3. Prepare Submission ID (stable for Storage and Firestore)
    const submissionId = adminDb.collection("entities").doc(entityId).collection("applicationSubmissions").doc().id;

    // 4. Process Attachments
    const attachments: any[] = [];
    const fileFields = ["cv", "coverLetter"];

    for (const type of fileFields) {
      const file = formData.get(type) as File | null;
      if (file && file.size > 0) {
        const attachmentId = `${type}_${Date.now()}`;
        const safeName = file.name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
        const filePath = `entities/${entityId}/applicationSubmissions/${submissionId}/attachments/${attachmentId}-${safeName}`;
        
        const buffer = Buffer.from(await file.arrayArray());
        
        await adminBucket.file(filePath).save(buffer, {
          metadata: { contentType: file.type }
        });
        
        uploadedFiles.push(filePath);

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

    // 5. Execute Transaction
    try {
      await executeSubmissionTransaction(entityId, form, answers, attachments, submissionId);
    } catch (txError: any) {
      // CLEANUP: If DB fails, remove files to avoid orphans
      console.error("[PUBLIC SUBMIT] Transaction failed, cleaning up files", txError);
      for (const path of uploadedFiles) {
        await adminBucket.file(path).delete().catch(() => {});
      }

      if (txError.message === "ALREADY_APPLIED_TO_THIS_JOB") {
        return NextResponse.json({ error: { message: "Vous avez déjà postulé à ce poste." } }, { status: 400 });
      }
      throw txError;
    }

    return NextResponse.json({ success: true, submissionId });

  } catch (error: any) {
    console.error("[PUBLIC SUBMIT] global failure", error);
    return NextResponse.json({ 
      error: { 
        message: "Une erreur est survenue lors de l'envoi de votre candidature. Veuillez réessayer.",
        debugMessage: process.env.NODE_ENV === "development" ? error.message : undefined
      } 
    }, { status: 500 });
  }
}
