import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { executeSubmissionTransaction } from "@/services/application-submission.service";

/**
 * Public endpoint for application submissions.
 * Handles identity normalization, deduplication, and atomic document creation.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Initial check for Admin SDK availability (avoids obscure crash if credentials missing)
    if (!adminDb) {
      console.error("[Submit API] adminDb is not initialized.");
      return NextResponse.json({ 
        success: false, 
        error: { 
          code: "FIREBASE_ADMIN_ERROR", 
          message: "Le service de soumission est momentanément indisponible (Erreur configuration)." 
        } 
      }, { status: 500 });
    }

    const body = await req.json();
    const { publicSlug, answers } = body;

    if (!publicSlug) {
      return NextResponse.json({ 
        success: false, 
        error: "Le slug de l'offre est manquant." 
      }, { status: 400 });
    }

    console.log(`[Submit API] Received submission for: ${publicSlug}`);

    // 2. Load Form and verify status (Collection Group search)
    const formsSnap = await adminDb.collectionGroup("applicationForms")
      .where("publicSlug", "==", publicSlug)
      .where("status", "==", "published")
      .limit(1)
      .get();

    if (formsSnap.empty) {
      return NextResponse.json({ 
        success: false, 
        error: "Cette offre n'est plus disponible." 
      }, { status: 404 });
    }

    const formDoc = formsSnap.docs[0];
    const formData = formDoc.data();
    const entityId = formData.entityId;

    // 3. Execute Transaction
    const result = await executeSubmissionTransaction(entityId, formData, answers);

    return NextResponse.json({ 
      success: true, 
      data: result 
    });

  } catch (error: any) {
    console.error("[Submit API] Submission failed:", error);
    
    // Catch-all for specific business logic errors from the service
    const status = error.message?.includes("déjà postulé") ? 409 : 500;
    
    return NextResponse.json({ 
      success: false, 
      error: {
        message: error.message || "Une erreur inattendue est survenue lors du traitement de votre candidature.",
        code: error.code || "SUBMISSION_ERROR"
      }
    }, { status });
  }
}
