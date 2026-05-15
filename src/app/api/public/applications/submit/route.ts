
import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminBucket } from "@/lib/firebase/admin";
import { executeSubmissionTransaction } from "@/services/application-submission.service";
import { AttachmentMetadata } from "@/types/application-submission";
import { v4 as uuidv4 } from "uuid";

export const dynamic = "force-dynamic";

/**
 * Validates if a required value is truly missing (handles 0 and false as valid).
 */
function isMissingRequiredValue(value: unknown) {
  return value === undefined || value === null || value === "";
}

export async function POST(request: NextRequest) {
  const submissionId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const uploadedFiles: { id: string; path: string }[] = [];

  try {
    const formData = await request.formData();
    const publicSlug = formData.get("publicSlug") as string;
    const answersStr = formData.get("answers") as string;

    if (!publicSlug) {
      return NextResponse.json({ error: { message: "Lien invalide." } }, { status: 400 });
    }

    const answers = JSON.parse(answersStr || "{}");

    // 1. Fetch Form with Admin SDK
    const formsRef = adminDb.collectionGroup("applicationForms");
    const formSnap = await formsRef
      .where("publicSlug", "==", publicSlug)
      .where("status", "==", "published")
      .limit(1)
      .get();

    if (formSnap.empty) {
      return NextResponse.json({ error: { message: "Offre non trouvée ou expirée." } }, { status: 404 });
    }

    const formDoc = formSnap.docs[0];
    const form = formDoc.data();
    const entityId = form.entityId;

    // 2. Validate Required Fields
    for (const field of form.fields || []) {
      if (field.enabled === false) continue;
      const val = answers[field.key];

      if (field.required) {
        // Special case for consent checkbox
        if (field.key === "consent" && val !== true) {
          return NextResponse.json({ error: { message: "Vous devez accepter les conditions pour postuler." } }, { status: 400 });
        }
        if (field.type !== "file" && isMissingRequiredValue(val)) {
          return NextResponse.json({ error: { message: `Le champ "${field.label}" est obligatoire.` } }, { status: 400 });
        }
      }
    }

    // 3. Process Attachments
    const attachments: AttachmentMetadata[] = [];
    const fileFields = ["cv", "coverLetter"];

    for (const key of fileFields) {
      const file = formData.get(key) as File | null;
      
      // Check if it's a valid File object and not an empty string/null
      if (file && typeof file !== "string" && file.size > 0 && typeof file.arrayBuffer === "function") {
        const attachmentId = uuidv4();
        const safeName = file.name.replace(/[^a-z0-9.]/gi, "_").toLowerCase();
        const filePath = `entities/${entityId}/applicationSubmissions/${submissionId}/attachments/${attachmentId}-${safeName}`;

        try {
          console.log(`[PUBLIC SUBMIT] Starting upload for ${key}: ${filePath}`);
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          await adminBucket.file(filePath).save(buffer, {
            metadata: {
              contentType: file.type,
            },
          });

          uploadedFiles.push({ id: attachmentId, path: filePath });
          
          attachments.push({
            id: attachmentId,
            type: key === "cv" ? "cv" : "cover_letter",
            fileName: file.name,
            filePath: filePath,
            mimeType: file.type,
            size: file.size,
            uploadedAt: new Date().toISOString(),
          });
        } catch (uploadError: any) {
          console.error(`[PUBLIC SUBMIT] ${key} upload failed`, {
            message: uploadError?.message,
            code: uploadError?.code,
            bucket: adminBucket.name,
            path: filePath
          });
          
          return NextResponse.json({
            error: {
              message: `Erreur lors du transfert du fichier ${key}.`,
              code: "UPLOAD_FAILED",
              debugMessage: process.env.NODE_ENV === "development" ? uploadError?.message : undefined
            }
          }, { status: 500 });
        }
      } else if (form.fields.find((f: any) => f.key === key && f.required && f.enabled !== false)) {
        return NextResponse.json({ error: { message: `Le document "${key.toUpperCase()}" est obligatoire.` } }, { status: 400 });
      }
    }

    // 4. Database Transaction
    try {
      await executeSubmissionTransaction(entityId, form, answers, attachments, submissionId);
      return NextResponse.json({ success: true, submissionId });
    } catch (txError: any) {
      console.error("[PUBLIC SUBMIT] Transaction failed", txError);

      // Rollback: Delete uploaded files
      for (const f of uploadedFiles) {
        await adminBucket.file(f.path).delete().catch(() => {});
      }

      if (txError.message === "ALREADY_APPLIED_TO_THIS_JOB") {
        return NextResponse.json({ error: { message: "Vous avez déjà postulé à ce poste.", code: "DUPLICATE" } }, { status: 400 });
      }

      return NextResponse.json({
        error: {
          message: "Erreur lors de l'enregistrement de votre candidature.",
          code: "TX_FAILED",
          debugMessage: process.env.NODE_ENV === "development" ? txError?.message : undefined
        }
      }, { status: 500 });
    }

  } catch (error: any) {
    console.error("[PUBLIC SUBMIT] Global failure", error);
    return NextResponse.json({
      error: {
        message: "Une erreur est survenue lors de l'envoi de votre candidature.",
        code: "GLOBAL_ERROR",
        debugMessage: process.env.NODE_ENV === "development" ? error?.message : undefined
      }
    }, { status: 500 });
  }
}
