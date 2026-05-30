import { NextRequest, NextResponse } from "next/server";
import { getPublicFormBySlug } from "@/services/application-form.service";
import { executeSubmissionTransaction } from "@/services/application-submission.service";
import { adminBucket } from "@/lib/firebase/admin";
import { AttachmentMetadata } from "@/types/application-submission";
import { randomUUID } from "crypto";

/**
 * @fileOverview Public API route for candidate application submissions.
 * Handles form validation, file uploads to Storage, and atomic database creation.
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
    const form = await getPublicFormBySlug(publicSlug);

    if (!form || form.status !== "published") {
      return NextResponse.json({ error: "Ce formulaire n'est plus disponible." }, { status: 404 });
    }

    const entityId = form.entityId;

    // 1. Validation des champs requis
    for (const field of form.fields) {
      if (field.required) {
        const val = answers[field.key];
        
        // TS2367 FIX: Normalize string/boolean/null to a safe boolean check
        // Checkboxes from FormData can be "on", "true", or "1". 
        // We use (val as any) to safely compare against boolean true if present.
        const isAccepted = val === "true" || val === "on" || val === "1" || (val as any) === true;
        
        if (field.type === "checkbox" || field.type === "checkboxGroup" || field.type === "file") {
          if (field.type === "checkbox" && !isAccepted) {
             return NextResponse.json({ error: `Le champ "${field.label}" est obligatoire.` }, { status: 400 });
          }
          if (field.type === "file" && !formData.get(field.key)) {
             return NextResponse.json({ error: `Le fichier "${field.label}" est obligatoire.` }, { status: 400 });
          }
          if (field.type === "checkboxGroup" && (!Array.isArray(val) || val.length === 0)) {
             return NextResponse.json({ error: `Le champ "${field.label}" est obligatoire.` }, { status: 400 });
          }
        } else {
           if (val === undefined || val === null || val === "") {
             return NextResponse.json({ error: `Le champ "${field.label}" est obligatoire.` }, { status: 400 });
           }
        }
      }
    }

    // 2. Traitement des fichiers (Upload vers Firebase Storage via Admin SDK)
    const attachments: AttachmentMetadata[] = [];
    const fileFields = form.fields.filter(f => f.type === 'file');

    for (const field of fileFields) {
      const file = formData.get(field.key) as File | null;
      if (file && file.size > 0) {
        const fileId = randomUUID();
        const extension = file.name.split('.').pop() || 'dat';
        const filePath = `entities/${entityId}/submissions/attachments/${fileId}.${extension}`;
        
        const buffer = Buffer.from(await file.arrayBuffer());
        const bucketFile = adminBucket.file(filePath);
        
        await bucketFile.save(buffer, {
          metadata: { 
            contentType: file.type,
            metadata: {
              originalName: file.name,
              formId: form.formId,
              entityId: entityId
            }
          }
        });

        attachments.push({
          id: fileId,
          type: field.key as any,
          fileName: file.name,
          filePath,
          mimeType: file.type,
          size: file.size,
          uploadedAt: new Date().toISOString()
        });
      }
    }

    // 3. Transaction de soumission (Person/Candidate/Submission creation)
    const result = await executeSubmissionTransaction(
      entityId, 
      form, 
      answers, 
      attachments
    );

    return NextResponse.json({ 
      success: true, 
      submissionId: result.submissionId,
      candidateId: result.candidateId 
    });

  } catch (err: any) {
    console.error("[Public Submission API Error]", err);
    
    // Identity Conflict Handling (Email exists but name/tax-code mismatch)
    if (err.message?.includes("IDENTITY_CONFLICT")) {
      return NextResponse.json({ 
        error: {
          message: "Une incohérence d'identité a été détectée. Si vous avez déjà un compte, veuillez utiliser les mêmes informations ou contacter le support.",
          debugMessage: err.message 
        }
      }, { status: 409 });
    }

    // Deduplication Handling
    if (err.message === "ALREADY_APPLIED_TO_THIS_JOB") {
      return NextResponse.json({ 
        error: "Vous avez déjà postulé à cette offre d'emploi." 
      }, { status: 400 });
    }

    return NextResponse.json({ 
      error: "Une erreur est survenue lors de l'enregistrement de votre candidature. Veuillez réessayer." 
    }, { status: 500 });
  }
}
