import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminBucket } from "@/lib/firebase/admin";
import { executeSubmissionTransaction, normalizeEmail, computeDedupeKey } from "@/services/application-submission.service";
import { AttachmentMetadata } from "@/types/application-submission";

export const dynamic = 'force-dynamic';

/**
 * API Route for public candidate applications.
 * Handles form validation, file uploads to Storage, and atomic Firestore transaction.
 */
export async function POST(request: NextRequest) {
  const submissionId = adminDb.collection("entities").doc().id;
  const uploadedFiles: string[] = [];

  console.log("[PUBLIC SUBMIT] Starting submission", { submissionId });

  try {
    const formData = await request.formData();
    const publicSlug = formData.get("publicSlug") as string;
    const answersRaw = formData.get("answers") as string;

    if (!publicSlug || !answersRaw) {
      return NextResponse.json({ 
        error: { 
          message: "Paramètres de formulaire invalides.",
          code: "INVALID_PARAMS"
        } 
      }, { status: 400 });
    }

    const answers = JSON.parse(answersRaw);
    console.log("[PUBLIC SUBMIT] Data parsed", { publicSlug, email: answers.email });

    // 1. Fetch form using Admin SDK to verify it exists and is published
    const formsSnap = await adminDb.collectionGroup("applicationForms")
      .where("publicSlug", "==", publicSlug)
      .where("status", "==", "published")
      .limit(1)
      .get();

    if (formsSnap.empty) {
      console.warn("[PUBLIC SUBMIT] Form not found or not published", { publicSlug });
      return NextResponse.json({ 
        error: { 
          message: "Cette offre d'emploi n'est plus disponible.",
          code: "FORM_NOT_FOUND"
        } 
      }, { status: 404 });
    }

    const formDoc = formsSnap.docs[0];
    const form = formDoc.data();
    const entityId = form.entityId;

    // 2. Pre-check for duplicates to avoid unnecessary uploads
    const normEmail = normalizeEmail(answers.email || "");
    const dedupeKey = computeDedupeKey(entityId, form.recruitmentNeedId, normEmail);
    const dedupeRef = adminDb.collection("entities").doc(entityId).collection("applicationSubmissionDedupe").doc(dedupeKey);
    const dedupeSnap = await dedupeRef.get();

    if (dedupeSnap.exists) {
      console.warn("[PUBLIC SUBMIT] Duplicate application detected", { dedupeKey });
      return NextResponse.json({ 
        error: { 
          message: "Vous avez déjà postulé à ce poste.", 
          code: "ALREADY_APPLIED" 
        } 
      }, { status: 400 });
    }

    // 3. Process Attachments (CV, Cover Letter)
    const attachments: AttachmentMetadata[] = [];
    const fileKeys = ["cv", "coverLetter"];

    for (const key of fileKeys) {
      const file = formData.get(key);
      
      // Standard File object check
      if (file && typeof file === "object" && "arrayBuffer" in file) {
        const f = file as unknown as File;
        
        // Skip empty inputs (browser sometimes sends a 0-byte file for optional empty inputs)
        if (f.size === 0) continue;

        console.log(`[PUBLIC SUBMIT] Processing ${key}:`, { name: f.name, size: f.size, type: f.type });

        try {
          // Convert to Buffer for Admin Storage save() method
          const arrayBuffer = await f.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          
          const attachmentId = `${key}_${Date.now()}`;
          const safeName = f.name.replace(/[^a-z0-9.]/gi, '_');
          const filePath = `entities/${entityId}/applicationSubmissions/${submissionId}/attachments/${attachmentId}-${safeName}`;

          console.log(`[PUBLIC SUBMIT] Uploading ${key} to Storage: ${filePath}`);
          
          await adminBucket.file(filePath).save(buffer, {
            metadata: { 
              contentType: f.type,
              metadata: {
                originalName: f.name,
                submissionId: submissionId
              }
            }
          });

          uploadedFiles.push(filePath);

          attachments.push({
            id: attachmentId,
            type: key === "cv" ? "cv" : "cover_letter",
            fileName: f.name,
            filePath,
            mimeType: f.type,
            size: f.size,
            uploadedAt: new Date().toISOString()
          });
        } catch (fileErr: any) {
          console.error(`[PUBLIC SUBMIT] File upload failed for ${key}:`, fileErr);
          throw new Error(`Erreur lors du transfert du fichier ${key}.`);
        }
      }
    }

    // 4. Atomic Database Transaction
    // This creates ApplicationSubmission, Candidate, and Person Timeline event
    console.log("[PUBLIC SUBMIT] Executing database transaction");
    await executeSubmissionTransaction(entityId, form, answers, attachments, submissionId);

    console.log("[PUBLIC SUBMIT] Submission successful", { submissionId });
    return NextResponse.json({ success: true, submissionId });

  } catch (error: any) {
    console.error("[PUBLIC SUBMIT] Submission failed:", error);

    // Cleanup: Delete orphaned files from Storage if Firestore transaction fails
    if (uploadedFiles.length > 0) {
      console.log("[PUBLIC SUBMIT] Cleaning up orphaned files from Storage...");
      for (const path of uploadedFiles) {
        try {
          await adminBucket.file(path).delete();
        } catch (cleanupErr) {
          console.warn(`[PUBLIC SUBMIT] Cleanup failed for file: ${path}`);
        }
      }
    }

    return NextResponse.json({
      error: {
        message: "Une erreur est survenue lors de l'envoi de votre candidature. Veuillez réessayer.",
        code: "SUBMISSION_FAILED",
        debugMessage: process.env.NODE_ENV === "development" ? String(error?.message || error) : undefined
      }
    }, { status: 500 });
  }
}
