import { NextResponse } from "next/server";
import { getPublicFormBySlug } from "@/services/application-form.service";
import { executeSubmissionTransaction } from "@/services/application-submission.service";

/**
 * Secure API endpoint for unauthenticated candidate submissions.
 * All Firestore writes are handled server-side via Admin SDK.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { publicSlug, answers } = body;

    console.log(`[Submit API] Received submission request for slug: ${publicSlug}`);

    if (!publicSlug) {
      return NextResponse.json(
        { success: false, error: { code: "MISSING_SLUG", message: "Slug manquant." } },
        { status: 400 }
      );
    }

    if (!answers || typeof answers !== 'object') {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_DATA", message: "Données de formulaire invalides." } },
        { status: 400 }
      );
    }

    // 1. Securely resolve the form context
    const form = await getPublicFormBySlug(publicSlug);
    if (!form) {
      console.error(`[Submit API] Published form not found or inactive for slug: ${publicSlug}`);
      return NextResponse.json(
        { success: false, error: { code: "FORM_NOT_FOUND", message: "Cette offre n'est plus disponible aux candidatures." } },
        { status: 404 }
      );
    }

    console.log(`[Submit API] Form resolved: ${form.formId} (Entity: ${form.entityId})`);

    // 2. Execute the submission transaction (Dedupe + Person + Candidate)
    const result = await executeSubmissionTransaction(form.entityId, form, answers);

    console.log(`[Submit API] Submission processed successfully. ID: ${result.submissionId}`);

    return NextResponse.json({ 
      success: true, 
      data: {
        submissionId: result.submissionId,
        candidateId: result.candidateId
      }
    });

  } catch (error: any) {
    console.error("[Submit API] FATAL ERROR:", error);

    // Provide detailed error info in development
    const isDev = process.env.NODE_ENV === 'development';
    
    return NextResponse.json(
      { 
        success: false, 
        error: { 
          code: error.code || "SUBMISSION_FAILED", 
          message: error.message || "Une erreur est survenue lors de l'envoi de votre candidature.",
          details: isDev ? error.stack : undefined
        } 
      },
      { status: error.status || 500 }
    );
  }
}
