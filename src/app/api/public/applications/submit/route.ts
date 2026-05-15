import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import { 
  executeSubmissionTransaction, 
  computeDedupeKey, 
  normalizeEmail 
} from "@/services/application-submission.service";

/**
 * Handles the public application submission.
 * USES ADMIN SDK to bypass security rules and manage Storage uploads securely.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const publicSlug = formData.get("publicSlug") as string;
    const answersStr = formData.get("answers") as string;
    
    if (!publicSlug || !answersStr) {
      return NextResponse.json({ error: "Paramètres manquants." }, { status: 400 });
    }

    const answers = JSON.parse(answersStr);

    // 1. Resolve Form using Admin SDK
    const formsSnap = await adminDb.collectionGroup("applicationForms")
      .where("publicSlug", "==", publicSlug)
      .where("status", "==", "published")
      .limit(1)
      .get();

    if (formsSnap.empty) {
      return NextResponse.json({ error: "Cette offre n'est plus disponible." }, { status: 404 });
    }

    const formDoc = formsSnap.docs[0];
    const form = formDoc.data();
    const entityId = form.entityId;

    // 2. Early Deduplication Check (Before heavy file upload)
    const email = (answers.email || "").toString().trim();
    const normEmail = normalizeEmail(email);
    const dedupeKey = computeDedupeKey(entityId, form.recruitmentNeedId, normEmail);
    
    const dedupeSnap = await adminDb.collection("entities").doc(entityId)
      .collection("applicationSubmissionDedupe").doc(dedupeKey).get();
    
    if (dedupeSnap.exists) {
      return NextResponse.json({ 
        error: { 
          code: "ALREADY_APPLIED_TO_THIS_JOB", 
          message: "Vous avez déjà postulé à ce poste." 
        } 
      }, { status: 400 });
    }

    // 3. Stable Submission ID Generation
    const submissionId = adminDb.collection("entities").doc(entityId).collection("applicationSubmissions").doc().id;

    // 4. Handle Attachments
    const attachmentMetadata: any[] = [];
    const filesToUpload: { file: File, type: "cv" | "cover_letter", path: string }[] = [];

    const cvFile = formData.get("cv") as File | null;
    const coverLetterFile = formData.get("coverLetter") as File | null;

    if (cvFile && cvFile.size > 0) {
      const attId = "att_cv_" + Date.now();
      const safeName = cvFile.name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
      const path = `entities/${entityId}/applicationSubmissions/${submissionId}/attachments/${attId}-${safeName}`;
      
      attachmentMetadata.push({
        id: attId,
        type: "cv",
        fileName: cvFile.name,
        filePath: path,
        mimeType: cvFile.type,
        size: cvFile.size,
        uploadedAt: new Date().toISOString()
      });
      filesToUpload.push({ file: cvFile, type: "cv", path });
    }

    if (coverLetterFile && coverLetterFile.size > 0) {
      const attId = "att_cl_" + Date.now();
      const safeName = coverLetterFile.name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
      const path = `entities/${entityId}/applicationSubmissions/${submissionId}/attachments/${attId}-${safeName}`;
      
      attachmentMetadata.push({
        id: attId,
        type: "cover_letter",
        fileName: coverLetterFile.name,
        filePath: path,
        mimeType: coverLetterFile.type,
        size: coverLetterFile.size,
        uploadedAt: new Date().toISOString()
      });
      filesToUpload.push({ file: coverLetterFile, type: "cover_letter", path });
    }

    // 5. Upload to Storage
    const bucket = adminStorage.bucket();
    const uploadedPaths: string[] = [];

    try {
      for (const item of filesToUpload) {
        const buffer = Buffer.from(await item.file.arrayBuffer());
        await bucket.file(item.path).save(buffer, {
          metadata: { contentType: item.file.type }
        });
        uploadedPaths.push(item.path);
      }

      // 6. Execute Transactional Database Write
      await executeSubmissionTransaction(entityId, form, answers, attachmentMetadata, submissionId);

      return NextResponse.json({ success: true, submissionId });

    } catch (dbError: any) {
      // 7. Cleanup on DB failure: Delete uploaded files to prevent orphans
      console.error("[Submission API] Transaction failed, cleaning up files...", dbError);
      for (const path of uploadedPaths) {
        await bucket.file(path).delete().catch(e => console.warn(`[Cleanup] Failed to delete ${path}:`, e));
      }

      if (dbError.message === "ALREADY_APPLIED_TO_THIS_JOB") {
        return NextResponse.json({ 
          error: { code: "ALREADY_APPLIED_TO_THIS_JOB", message: "Vous avez déjà postulé à ce poste." } 
        }, { status: 400 });
      }

      throw dbError;
    }

  } catch (err: any) {
    console.error("[Submission API Error]", err);
    return NextResponse.json({ 
      error: "Une erreur est survenue lors de l'envoi de votre candidature. Veuillez réessayer." 
    }, { status: 500 });
  }
}