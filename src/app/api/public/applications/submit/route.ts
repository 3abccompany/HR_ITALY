import { NextRequest, NextResponse } from "next/server";
import { getPublicFormBySlug } from "@/services/application-form.service";
import { executeSubmissionTransaction } from "@/services/application-submission.service";
import { adminBucket } from "@/lib/firebase/admin";
import { randomUUID } from "crypto";

export const dynamic = 'force-dynamic';

/**
 * Handles the public submission of candidate application forms.
 * Performs validation, file uploads to storage, and transactional Firestore writes.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const publicSlug = formData.get("publicSlug") as string;
    const answersStr = formData.get("answers") as string;

    if (!publicSlug || !answersStr) {
      return NextResponse.json({ error: { message: "Paramètres de soumission manquants." } }, { status: 400 });
    }

    const answers = JSON.parse(answersStr);
    const form = await getPublicFormBySlug(publicSlug);

    if (!form) {
      return NextResponse.json({ error: { message: "Formulaire non trouvé ou fermé." } }, { status: 404 });
    }

    const entityId = form.entityId;
    const attachments: any[] = [];

    // 1. Validation and File Processing
    for (const field of form.fields) {
      const val = answers[field.key];
      
      // TS2367 Fix: Normalize boolean-like values from form data before comparison
      const isAccepted = val === true || val === "true" || val === "on" || val === "1";

      if (field.required) {
        if (field.type === 'checkbox') {
          if (!isAccepted) {
            return NextResponse.json({ error: { message: `Le champ "${field.label}" est obligatoire.` } }, { status: 400 });
          }
        } else if (field.type === 'file') {
          const file = formData.get(field.key);
          if (!file || !(file instanceof File) || file.size === 0) {
            return NextResponse.json({ error: { message: `Le fichier "${field.label}" est obligatoire.` } }, { status: 400 });
          }
        } else if (val === undefined || val === null || (typeof val === 'string' && val.trim() === "")) {
          return NextResponse.json({ error: { message: `Le champ "${field.label}" est obligatoire.` } }, { status: 400 });
        }
      }

      // Process and upload files if present
      if (field.type === 'file') {
        const file = formData.get(field.key);
        if (file && file instanceof File && file.size > 0) {
          const fileId = randomUUID();
          const filePath = `entities/${entityId}/submissions/attachments/${fileId}_${file.name}`;
          
          const buffer = Buffer.from(await file.arrayBuffer());
          await adminBucket.file(filePath).save(buffer, {
            metadata: { contentType: file.type }
          });

          attachments.push({
            id: fileId,
            type: field.key,
            fileName: file.name,
            filePath,
            mimeType: file.type,
            size: file.size,
            uploadedAt: new Date().toISOString()
          });
        }
      }
    }

    // 2. Transactional execution of business logic (Dedupe, Person creation, Candidate link)
    const result = await executeSubmissionTransaction(entityId, form, answers, attachments);

    return NextResponse.json({ success: true, ...result });

  } catch (error: any) {
    console.error("[Public Submission Route Error]", error);
    
    let userMessage = "Une erreur est survenue lors de l'envoi.";
    let statusCode = 500;

    if (error.message === "ALREADY_APPLIED_TO_THIS_JOB") {
      userMessage = "Vous avez déjà envoyé une candidature pour ce poste.";
      statusCode = 409;
    } else if (error.message.startsWith("IDENTITY_CONFLICT")) {
      userMessage = "Cette adresse email est déjà associée à un profil différent. Veuillez vérifier vos informations.";
      statusCode = 409;
    }

    return NextResponse.json({ 
      error: { 
        message: userMessage,
        debugMessage: process.env.NODE_ENV === 'development' ? error.message : undefined
      } 
    }, { status: statusCode });
  }
}
