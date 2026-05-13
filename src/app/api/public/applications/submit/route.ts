
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { executeSubmissionTransaction } from "@/services/application-submission.service";

/**
 * POST /api/public/applications/submit
 * Public gateway for candidate application submissions.
 */
export async function POST(request: Request) {
  console.log("[API/Submit] Starting submission process...");
  
  try {
    const body = await request.json();
    const { publicSlug, answers } = body;

    if (!publicSlug) {
      return NextResponse.json({ 
        error: { message: "Le slug du formulaire est manquant.", code: "MISSING_SLUG" } 
      }, { status: 400 });
    }

    if (!answers) {
      return NextResponse.json({ 
        error: { message: "Les réponses au formulaire sont manquantes.", code: "MISSING_ANSWERS" } 
      }, { status: 400 });
    }

    console.log(`[API/Submit] Looking up form for slug: ${publicSlug}`);

    // 1. Find form by slug using collectionGroup (Privileged lookup)
    const formSnap = await adminDb.collectionGroup("applicationForms")
      .where("publicSlug", "==", publicSlug)
      .where("status", "==", "published")
      .limit(1)
      .get();

    if (formSnap.empty) {
      console.warn(`[API/Submit] Form not found or not published: ${publicSlug}`);
      return NextResponse.json({ 
        error: { message: "Désolé, cette offre n'est plus disponible.", code: "FORM_NOT_AVAILABLE" } 
      }, { status: 404 });
    }

    const formDoc = formSnap.docs[0];
    const form = formDoc.data();
    const entityId = form.entityId;

    if (!entityId) {
      throw new Error("Missing entityId in form configuration");
    }

    console.log(`[API/Submit] Found form ${formDoc.id} in entity ${entityId}. Processing transaction...`);

    // 2. Execute the submission transaction
    const result = await executeSubmissionTransaction(entityId, form, answers);

    console.log(`[API/Submit] Submission successfully completed: ${result.submissionId}`);

    return NextResponse.json({
      success: true,
      data: result
    });

  } catch (error: any) {
    console.error("[API/Submit] Submission failed with error:", error);
    
    const statusCode = error.message?.includes("déjà postulé") ? 409 : 500;
    
    return NextResponse.json({
      error: {
        message: error.message || "Une erreur interne est survenue lors de l'envoi de votre candidature.",
        code: error.code || "SUBMISSION_ERROR"
      }
    }, { status: statusCode });
  }
}
