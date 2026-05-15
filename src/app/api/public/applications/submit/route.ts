
import { NextRequest, NextResponse } from "next/server";
import { getPublicFormBySlug } from "@/services/application-form.service";
import { executeSubmissionTransaction } from "@/services/application-submission.service";
import { adminApp } from "@/lib/firebase/admin";
import { AttachmentMetadata } from "@/types/application-submission";

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let uploadedFiles: { id: string, path: string }[] = [];
  
  try {
    const formData = await request.formData();
    const publicSlug = formData.get("publicSlug") as string;
    const answers = JSON.parse(formData.get("answers") as string);

    if (!publicSlug) {
      return NextResponse.json({ error: "Missing slug" }, { status: 400 });
    }

    // 1. Resolve Form
    const form = await getPublicFormBySlug(publicSlug);
    if (!form) {
      return NextResponse.json({ error: "Form not found or closed" }, { status: 404 });
    }

    const entityId = form.entityId;
    const bucket = adminApp.storage().bucket();

    // 2. Process Files
    const attachments: AttachmentMetadata[] = [];
    const fileEntries = [
      { key: "cv", type: "cv" as const },
      { key: "coverLetter", type: "cover_letter" as const }
    ];

    for (const entry of fileEntries) {
      const file = formData.get(entry.key) as File | null;
      if (file && file.size > 0) {
        const attachmentId = `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const safeName = file.name.replace(/[^a-z0-9.]/gi, '_');
        const submissionIdPlaceholder = `sub_${Date.now()}`; // Temporary folder prefix
        const filePath = `entities/${entityId}/applicationSubmissions/${submissionIdPlaceholder}/attachments/${attachmentId}-${safeName}`;

        const buffer = Buffer.from(await file.arrayBuffer());
        const blob = bucket.file(filePath);
        
        await blob.save(buffer, {
          contentType: file.type,
          metadata: {
            entityId,
            attachmentType: entry.type
          }
        });

        uploadedFiles.push({ id: attachmentId, path: filePath });

        attachments.push({
          id: attachmentId,
          type: entry.type,
          fileName: file.name,
          filePath: filePath,
          mimeType: file.type,
          size: file.size,
          uploadedAt: new Date().toISOString()
        });
      }
    }

    // 3. Save to Database
    const result = await executeSubmissionTransaction(entityId, form, answers, attachments);

    // 4. Update file paths with real submission ID (Optional but cleaner for storage org)
    // For simplicity here, we keep the generated path but could rename if required.

    return NextResponse.json({ success: true, ...result });

  } catch (err: any) {
    console.error("[Submission API Error]", err);
    
    // Cleanup uploaded files on failure to prevent orphaned blobs
    if (uploadedFiles.length > 0) {
      const bucket = adminApp.storage().bucket();
      for (const f of uploadedFiles) {
        await bucket.file(f.path).delete().catch(() => {});
      }
    }

    if (err.message === "ALREADY_APPLIED_TO_THIS_JOB") {
      return NextResponse.json({ error: { code: "ALREADY_APPLIED_TO_THIS_JOB", message: "Déjà postulé." } }, { status: 409 });
    }

    return NextResponse.json({ error: err.message || "Submission failed" }, { status: 500 });
  }
}
