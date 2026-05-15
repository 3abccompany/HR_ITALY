
import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import { getAuth } from "firebase-admin/auth";

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string, submissionId: string, attachmentId: string }> }
) {
  const { entityId, submissionId, attachmentId } = await params;

  try {
    // 1. Auth Check
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    const token = authHeader.split(" ")[1];
    const decodedToken = await getAuth().verifyIdToken(token);
    const uid = decodedToken.uid;

    // 2. Membership & Permission Check
    const membershipId = `${uid}_${entityId}`;
    const mSnap = await adminDb.collection("memberships").doc(membershipId).get();
    
    if (!mSnap.exists || mSnap.data()?.status !== 'active') {
      return NextResponse.json({ error: "Forbidden: No active membership" }, { status: 403 });
    }

    const permissions = mSnap.data()?.permissions || [];
    if (!permissions.includes("candidates.read")) {
      return NextResponse.json({ error: "Forbidden: Permission required" }, { status: 403 });
    }

    // 3. Resolve File Path
    const subSnap = await adminDb.collection("entities").doc(entityId).collection("applicationSubmissions").doc(submissionId).get();
    if (!subSnap.exists) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    const submission = subSnap.data();
    const attachment = submission?.attachments?.find((a: any) => a.id === attachmentId);

    if (!attachment || !attachment.filePath) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    // 4. Generate Signed URL (15 minutes)
    const bucket = adminStorage.bucket();
    const file = bucket.file(attachment.filePath);
    
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
    });

    return NextResponse.json({ url });

  } catch (err: any) {
    console.error("[Signed URL API Error]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
