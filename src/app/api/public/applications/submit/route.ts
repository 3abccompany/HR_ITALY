import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminBucket } from "@/lib/firebase/admin";
import { executeSubmissionTransaction } from "@/services/application-submission.service";
import { AttachmentMetadata } from "@/types/application-submission";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const fileFields = ["cv", "coverLetter"];
    
    for (const key of fileFields) {
      const file = formData.get(key);
      if (file && file instanceof File) {
        const type = key === "cv" ? "cv" : "cover_letter";
        
        // Construct tenant-isolated and unique storage path
        const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const storagePath = `entities/${entityId}/applicationSubmissions/${submissionId}/${Date.now()}_${safeFileName}`;
        
        // Upload to Cloud Storage using Admin SDK
        const fileBuffer = Buffer.from(await file.arrayBuffer());
        const bucketFile = adminBucket.file(storagePath);
        
        await bucketFile.save(fileBuffer, {
          contentType: file.type,
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

        attachments.push({
          id: adminDb.collection("_").doc().id, // Metadata entry ID
          type,
          fileName: file.name,
          filePath: storagePath,
          mimeType: file.type,
          size: file.size,
          uploadedAt: new Date().toISOString()
        });
      }
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
