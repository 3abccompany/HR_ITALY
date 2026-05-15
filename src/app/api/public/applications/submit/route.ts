
import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminBucket } from "@/lib/firebase/admin";
import { executeSubmissionTransaction, normalizeEmail, computeDedupeKey } from "@/services/application-submission.service";
import { AttachmentMetadata } from "@/types/application-submission";

export const dynamic = 'force-dynamic';

function isMissingRequiredValue(value: unknown) {
  return value === undefined || value === null || value === "";
}

export async function POST(request: NextRequest) {
  console.log("[PUBLIC SUBMIT] Incoming request received");

  try {
    const formData = await request.formData();
    const publicSlug = formData.get("publicSlug") as string;
    const answersRaw = formData.get("answers") as string;

    if (!publicSlug || !answersRaw) {
      console.warn("[PUBLIC SUBMIT] Missing publicSlug or answersRaw");
      return NextResponse.json(
        { error: { message: "Paramètres manquants.", code: "MISSING_PARAMS" } },
        { status: 400 }
      );
    }

    const answers = JSON.parse(answersRaw);
    console.log("[PUBLIC SUBMIT] Data parsed", { publicSlug, answerKeys: Object.keys(answers) });

    // 1. Fetch Form
    const formsSnap = await adminDb
      .collectionGroup("applicationForms")
      .where("publicSlug", "==", publicSlug)
      .where("status", "==", "published")
      .limit(1)
      .get();

    if (formsSnap.empty) {
      console.warn("[PUBLIC SUBMIT] Form not found or not published", { publicSlug });
      return NextResponse.json(
        { error: { message: "Ce formulaire n'est plus disponible.", code: "FORM_NOT_FOUND" } },
        { status: 404 }
      );
    }

    const formDoc = formsSnap.docs[0];
    const form = formDoc.data();
    const entityId = form.entityId;

    // 2. Pre-Dedupe Check (Server-side)
    const email = (answers.email || "").toString().trim();
    if (!email) {
      return NextResponse.json(
        { error: { message: "L'adresse email est obligatoire.", code: "EMAIL_REQUIRED" } },
        { status: 400 }
      );
    }
    
    const normEmail = normalizeEmail(email);
    const dedupeKey = computeDedupeKey(entityId, form.recruitmentNeedId, normEmail);
    const dedupeRef = adminDb.collection("entities").doc(entityId).collection("applicationSubmissionDedupe").doc(dedupeKey);
    const dedupeSnap = await dedupeRef.get();

    if (dedupeSnap.exists) {
      console.log("[PUBLIC SUBMIT] Duplicate blocked (pre-check)", { email: normEmail });
      return NextResponse.json(
        { error: { message: "Vous avez déjà postulé à ce poste.", code: "ALREADY_APPLIED" } },
        { status: 400 }
      );
    }

    // 3. Required Fields Validation
    for (const field of form.fields) {
      if (field.enabled === false) continue;
      
      const val = answers[field.key];
      if (field.required && isMissingRequiredValue(val)) {
        // Special case for consent checkbox which must be true
        if (field.key === 'consent' || field.type === 'checkbox') {
           if (val !== true) {
             return NextResponse.json(
               { error: { message: `Veuillez accepter : ${field.label}`, code: "VALIDATION_FAILED" } },
               { status: 400 }
             );
           }
        } else if (field.type !== 'file') {
          return NextResponse.json(
            { error: { message: `Le champ "${field.label}" est obligatoire.`, code: "VALIDATION_FAILED" } },
            { status: 400 }
          );
        }
      }
    }

    // 4. Generate Stable submissionId
    const submissionId = adminDb.collection("entities").doc(entityId).collection("applicationSubmissions").doc().id;
    console.log("[PUBLIC SUBMIT] Generated submissionId", { submissionId });

    // 5. Process Files
    const attachments: AttachmentMetadata[] = [];
    const uploadedFilePaths: string[] = [];

    const fileFields = form.fields.filter((f: any) => f.type === 'file' && f.enabled !== false);

    for (const field of fileFields) {
      const file = formData.get(field.key) as File;
      if (!file || !(file instanceof File) || file.size === 0) {
        if (field.required) {
          return NextResponse.json(
            { error: { message: `Le document "${field.label}" est obligatoire.`, code: "FILE_REQUIRED" } },
            { status: 400 }
          );
        }
        continue;
      }

      const attachmentId = field.key === 'cv' ? 'cv' : field.key === 'coverLetter' ? 'cover_letter' : field.key;
      const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const filePath = `entities/${entityId}/applicationSubmissions/${submissionId}/attachments/${attachmentId}-${safeFileName}`;

      try {
        console.log(`[PUBLIC SUBMIT] Transferring ${field.key} to Storage`, {
          bucket: adminBucket.name,
          path: filePath,
          size: file.size,
          type: file.type
        });

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        await adminBucket.file(filePath).save(buffer, {
          resumable: false,
          metadata: { contentType: file.type }
        });
        
        uploadedFilePaths.push(filePath);
        attachments.push({
          id: attachmentId,
          type: (attachmentId === 'cv' || attachmentId === 'cover_letter') ? attachmentId : 'cv' as any,
          fileName: file.name,
          filePath,
          mimeType: file.type,
          size: file.size,
          uploadedAt: new Date().toISOString()
        });
        console.log(`[PUBLIC SUBMIT] ${field.key} successfully uploaded`);
      } catch (uploadErr: any) {
        console.error(`[PUBLIC SUBMIT] CRITICAL: Storage upload failed for ${field.key}`, {
          message: uploadErr?.message,
          code: uploadErr?.code,
          errors: uploadErr?.errors
        });
        
        // Cleanup already uploaded files before failing
        for (const path of uploadedFilePaths) {
          await adminBucket.file(path).delete().catch(() => {});
        }

        // Re-throw original error to expose it in debugMessage
        throw uploadErr;
      }
    }

    // 6. Execute Transaction
    console.log("[PUBLIC SUBMIT] Starting Firestore transaction");
    const result = await executeSubmissionTransaction(
      entityId, 
      form, 
      answers, 
      attachments, 
      submissionId
    );

    console.log("[PUBLIC SUBMIT] Submission success", result);
    return NextResponse.json({ success: true, ...result });

  } catch (error: any) {
    console.error("[PUBLIC SUBMIT] Global submission failure", error);
    
    // Technical detail exposure for dev mode
    const debugMessage = process.env.NODE_ENV === "development" 
      ? `${error.message}${error.code ? ' (Code: ' + error.code + ')' : ''}` 
      : undefined;

    return NextResponse.json(
      { 
        error: { 
          message: "Une erreur est survenue lors de l'envoi de votre candidature. Veuillez réessayer.",
          code: "PUBLIC_SUBMIT_FAILED",
          debugMessage
        } 
      },
      { status: 500 }
    );
  }
}
