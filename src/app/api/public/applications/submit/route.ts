
import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import { getPublicFormBySlug } from "@/services/application-form.service";
import { executeSubmissionTransaction } from "@/services/application-submission.service";
import { AttachmentMetadata } from "@/types/application-submission";

export const dynamic = 'force-dynamic';

/**
 * Handles public job application submissions.
 * This route manages file uploads to Storage and atomic database updates.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const publicSlug = formData.get("publicSlug") as string;
    const answersRaw = formData.get("answers") as string;
    const answers = JSON.parse(answersRaw || "{}");

    if (!publicSlug) {
      return NextResponse.json({ error: "Missing form slug" }, { status: 400 });
    }

    // 1. Resolve entity context
    const form = await getPublicFormBySlug(publicSlug);
    if (!form) {
      return NextResponse.json({ error: "Form not found or no longer active" }, { status: 404 });
    }

    const entityId = form.entityId;

    // 2. Pre-generate IDs to ensure correct storage paths
    const submissionId = adminDb.collection("entities").doc(entityId).collection("applicationSubmissions").doc().id;

    // 3. Handle File Uploads
    const attachments: AttachmentMetadata[] = [];
    const filesToProcess = [
      { key: "cv", type: "cv" as const },
      { key: "coverLetter", type: "cover_letter" as const }
    ];

    const bucket = adminStorage.bucket();
    const uploadedFilePaths: string[] = [];

    for (const item of filesToProcess) {
      const file = formData.get(item.key) as File;
      if (file && file.size > 0) {
        const attachmentId = `att_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const safeFileName = file.name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
        const filePath = `entities/${entityId}/applicationSubmissions/${submissionId}/attachments/${attachmentId}-${safeFileName}`;

        try {
          const buffer = Buffer.from(await file.arrayBuffer());
          await bucket.file(filePath).save(buffer, {
            metadata: { contentType: file.type }
          });
          
          uploadedFilePaths.push(filePath);
          attachments.push({
            id: attachmentId,
            type: item.type,
            fileName: file.name,
            filePath: filePath,
            mimeType: file.type,
            size: file.size,
            uploadedAt: new Date().toISOString()
          });
        } catch (uploadErr) {
          console.error(`[Upload Error] Failed to upload ${item.key}:`, uploadErr);
          // Cleanup already uploaded files for this attempt
          for (const path of uploadedFilePaths) {
            await bucket.file(path).delete().catch(() => {});
          }
          return NextResponse.json({ error: "Échec du téléchargement des fichiers." }, { status: 500 });
        }
      }
    }

    // 4. Atomically record submission and create candidate
    try {
      // Overriding internal executeSubmissionTransaction to use our pre-generated submissionId if needed
      // but for simplicity we let the service handle its IDs and metadata
      const result = await executeSubmissionTransaction(entityId, form, answers, attachments);
      return NextResponse.json(result);
    } catch (txErr: any) {
      console.error("[Transaction Error] Submission failed:", txErr);
      // Cleanup files since DB record failed
      for (const path of uploadedFilePaths) {
        await bucket.file(path).delete().catch(() => {});
      }

      if (txErr.message === "ALREADY_APPLIED_TO_THIS_JOB") {
        return NextResponse.json({ 
          error: { code: "ALREADY_APPLIED_TO_THIS_JOB", message: "Vous avez déjà postulé à ce poste." } 
        }, { status: 409 });
      }

      throw txErr;
    }

  } catch (error: any) {
    console.error("[Public Submission API Error]", error);
    return NextResponse.json({ 
      error: "Une erreur est survenue lors de l'envoi de votre candidature. Veuillez réessayer." 
    }, { status: 500 });
  }
}
