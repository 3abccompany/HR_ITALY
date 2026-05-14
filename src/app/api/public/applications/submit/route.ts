
import { NextRequest, NextResponse } from "next/server";
import { executeSubmissionTransaction } from "@/services/application-submission.service";
import { getPublicFormBySlug } from "@/services/application-form.service";

export async function POST(req: NextRequest) {
  try {
    const { publicSlug, answers } = await req.json();

    if (!publicSlug) {
      return NextResponse.json({ error: "Slug manquant" }, { status: 400 });
    }

    // 1. Fetch form context (Server-side lookup)
    const form = await getPublicFormBySlug(publicSlug);
    if (!form) {
      return NextResponse.json({ error: "Offre introuvable ou fermée" }, { status: 404 });
    }

    // 2. Execute atomic submission
    const result = await executeSubmissionTransaction(form.entityId, form, answers);

    return NextResponse.json({ success: true, ...result });

  } catch (error: any) {
    console.error("[Public Submit API] Critical Failure:", error);

    // Handle structured domain errors
    if (error.message === "ALREADY_APPLIED_TO_THIS_JOB") {
      return NextResponse.json({ 
        error: { 
          code: "ALREADY_APPLIED_TO_THIS_JOB", 
          message: "Vous avez déjà postulé à ce poste." 
        } 
      }, { status: 409 });
    }

    if (error.message?.includes("Missing Firebase Admin credentials")) {
       return NextResponse.json({ 
        error: { 
          code: "FIREBASE_ADMIN_CREDENTIALS_MISSING", 
          message: "Le serveur n'est pas configuré pour recevoir des candidatures." 
        } 
      }, { status: 500 });
    }

    return NextResponse.json({ 
      error: error.message || "Une erreur interne est survenue." 
    }, { status: 500 });
  }
}
