import { NextRequest, NextResponse } from "next/server";
import { executeSubmissionTransaction } from "@/services/application-submission.service";
import { adminBucket, adminDb } from "@/lib/firebase/admin";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

type PublicApplicationFormField = {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  enabled?: boolean;
  options?: string[];
  [key: string]: any;
};

type PublicApplicationFormForSubmit = {
  id: string;
  formId: string;
  entityId: string;
  status: string;
  publicSlug?: string;
  fields: PublicApplicationFormField[];

  recruitmentNeedId?: string;
  recruitmentNeedTitle?: string;

  jobProfileId?: string;
  jobProfileTitle?: string;

  departmentId?: string;
  departmentName?: string;

  jobTitleId?: string;
  jobTitleName?: string;

  worksiteId?: string | null;
  worksiteName?: string;

  title?: string;
  description?: string;

  [key: string]: any;
};

function normalizeFormSnapshot(
  docSnap: FirebaseFirestore.DocumentSnapshot,
  publicSlug: string
): PublicApplicationFormForSubmit | null {
  if (!docSnap.exists) return null;

  const data = docSnap.data() || {};
  const status = String(data.status || "");

  if (!["published", "active"].includes(status)) {
    return null;
  }

  if (data.publicSlug && data.publicSlug !== publicSlug) {
    return null;
  }

  const fields = Array.isArray(data.fields) ? data.fields : [];

  return {
    ...data,

    id: docSnap.id,
    formId: data.formId || docSnap.id,
    entityId: data.entityId || "",
    status,
    publicSlug: data.publicSlug || publicSlug,
    fields,

    recruitmentNeedId: data.recruitmentNeedId || "",
    recruitmentNeedTitle: data.recruitmentNeedTitle || "",

    jobProfileId: data.jobProfileId || "",
    jobProfileTitle: data.jobProfileTitle || "",

    departmentId: data.departmentId || "",
    departmentName: data.departmentName || "",

    jobTitleId: data.jobTitleId || "",
    jobTitleName: data.jobTitleName || "",

    worksiteId: data.worksiteId || null,
    worksiteName: data.worksiteName || "",

    title: data.title || "",
    description: data.description || "",
  };
}

/**
 * Direct server-side form lookup.
 * No collectionGroup query.
 * No Firestore composite index required.
 */
async function getPublicFormForSubmitServer(input: {
  publicSlug: string;
  entityId: string;
  formId: string;
}): Promise<PublicApplicationFormForSubmit | null> {
  const { publicSlug, entityId, formId } = input;

  if (!publicSlug || !entityId || !formId) {
    return null;
  }

  const formRef = adminDb
    .collection("entities")
    .doc(entityId)
    .collection("applicationForms")
    .doc(formId);

  const formSnap = await formRef.get();

  return normalizeFormSnapshot(formSnap, publicSlug);
}

/**
 * Handles the public submission of candidate application forms.
 * Performs validation, file uploads to storage, and transactional Firestore writes.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const publicSlug = String(formData.get("publicSlug") || "").trim();
    const entityIdFromRequest = String(formData.get("entityId") || "").trim();
    const formIdFromRequest = String(formData.get("formId") || "").trim();
    const answersStr = String(formData.get("answers") || "");

    if (!publicSlug || !answersStr) {
      return NextResponse.json(
        {
          error: {
            message: "Paramètres de soumission manquants.",
          },
        },
        { status: 400 }
      );
    }

    if (!entityIdFromRequest || !formIdFromRequest) {
      return NextResponse.json(
        {
          error: {
            message:
              "Contexte formulaire manquant. Veuillez recharger la page et réessayer.",
          },
        },
        { status: 400 }
      );
    }

    let answers: Record<string, any>;

    try {
      answers = JSON.parse(answersStr);
    } catch {
      return NextResponse.json(
        {
          error: {
            message: "Format des réponses invalide.",
          },
        },
        { status: 400 }
      );
    }

    const form = await getPublicFormForSubmitServer({
      publicSlug,
      entityId: entityIdFromRequest,
      formId: formIdFromRequest,
    });

    if (!form) {
      return NextResponse.json(
        {
          error: {
            message: "Formulaire non trouvé ou fermé.",
          },
        },
        { status: 404 }
      );
    }

    const entityId = form.entityId;

    if (!entityId) {
      return NextResponse.json(
        {
          error: {
            message: "Contexte entreprise manquant pour ce formulaire.",
          },
        },
        { status: 400 }
      );
    }

    const fields = Array.isArray(form.fields) ? form.fields : [];
    const attachments: any[] = [];

    for (const field of fields) {
      if (field.enabled === false) continue;

      const val = answers[field.key];

      const isAccepted =
        val === true || val === "true" || val === "on" || val === "1";

      if (field.required) {
        if (field.type === "checkbox") {
          if (!isAccepted) {
            return NextResponse.json(
              {
                error: {
                  message: `Le champ "${field.label}" est obligatoire.`,
                },
              },
              { status: 400 }
            );
          }
        } else if (field.type === "file") {
          const file = formData.get(field.key);

          if (!file || !(file instanceof File) || file.size === 0) {
            return NextResponse.json(
              {
                error: {
                  message: `Le fichier "${field.label}" est obligatoire.`,
                },
              },
              { status: 400 }
            );
          }
        } else if (
          val === undefined ||
          val === null ||
          (typeof val === "string" && val.trim() === "")
        ) {
          return NextResponse.json(
            {
              error: {
                message: `Le champ "${field.label}" est obligatoire.`,
              },
            },
            { status: 400 }
          );
        }
      }

      if (field.type === "file") {
        const file = formData.get(field.key);

        if (file && file instanceof File && file.size > 0) {
          const fileId = randomUUID();
          const safeFileName = file.name.replace(/[^\w.\-() ]+/g, "_");
          const filePath = `entities/${entityId}/submissions/attachments/${fileId}_${safeFileName}`;

          const buffer = Buffer.from(await file.arrayBuffer());

          await adminBucket.file(filePath).save(buffer, {
            metadata: {
              contentType: file.type || "application/octet-stream",
            },
          });

          attachments.push({
            id: fileId,
            type: field.key,
            fileName: file.name,
            filePath,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            uploadedAt: new Date().toISOString(),
          });
        }
      }
    }

    const result = await executeSubmissionTransaction(
      entityId,
      form,
      answers,
      attachments
    );

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error("[Public Submission Route Error]", error);

    let userMessage = "Une erreur est survenue lors de l'envoi.";
    let statusCode = 500;

    if (error.message === "ALREADY_APPLIED_TO_THIS_JOB") {
      userMessage = "Vous avez déjà envoyé une candidature pour ce poste.";
      statusCode = 409;
    } else if (error.message?.startsWith("IDENTITY_CONFLICT")) {
      userMessage =
        "Cette adresse email est déjà associée à un profil différent. Veuillez vérifier vos informations.";
      statusCode = 409;
    }

    return NextResponse.json(
      {
        error: {
          message: userMessage,
          debugMessage:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        },
      },
      { status: statusCode }
    );
  }
}