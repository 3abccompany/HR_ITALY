'use server';

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import crypto from "crypto";
import { sendEmployeeInvitationEmailAction } from "./email.service";

/**
 * @fileOverview Server-only service for managing employee user accounts and invitations.
 * Phase 1A: Employee Access Foundation.
 */

/**
 * Invites an existing employee to activate their personal space.
 * Generates a secure token, hashes it, and stores the invitation metadata.
 */
export async function inviteEmployeeToEmployeeSpace(params: {
  entityId: string;
  employeeId: string;
  actorUid: string;
}) {
  const { entityId, employeeId, actorUid } = params;

  if (!adminDb) throw new Error("Firestore Admin not initialized");

  const employeeRef = adminDb.collection("entities").doc(entityId).collection("employees").doc(employeeId);
  
  return await adminDb.runTransaction(async (transaction) => {
    // 1. READ
    const empSnap = await transaction.get(employeeRef);
    if (!empSnap.exists) throw new Error("Employé introuvable.");
    const employee = empSnap.data()!;

    if (!employee.email) throw new Error("L'employé ne possède pas d'adresse email configurée.");
    if (employee.accountStatus === "active") throw new Error("Cet employé possède déjà un compte actif.");

    // 2. TOKEN GENERATION (Secure)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const validityHours = 48;
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + validityHours);

    // 3. INVITATION CREATION
    const invitationRef = adminDb.collection("entities").doc(entityId).collection("employeeInvitations").doc();
    const invitationId = invitationRef.id;

    transaction.set(invitationRef, {
      id: invitationId,
      entityId,
      employeeId,
      email: employee.email,
      tokenHash,
      status: "pending",
      role: "employee",
      expiresAt: Timestamp.fromDate(expiresAt),
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actorUid
    });

    // 4. UPDATE EMPLOYEE RECORD
    transaction.update(employeeRef, {
      accountEmail: employee.email,
      accountStatus: "invited",
      accountRole: "employee",
      invitedAt: FieldValue.serverTimestamp(),
      invitedBy: actorUid,
      updatedAt: FieldValue.serverTimestamp()
    });

    // 5. EMAIL DISPATCH
    const baseUrl = process.env.APP_PUBLIC_URL || "http://localhost:9002";
    const activationLink = `${baseUrl}/activate/${rawToken}`;

    const emailResult = await sendEmployeeInvitationEmailAction({
      entityId,
      to: employee.email,
      employeeName: employee.displayName || `${employee.firstName} ${employee.lastName}`,
      activationLink
    });

    if (!emailResult.success) {
      throw new Error(`Échec de l'envoi de l'email : ${emailResult.error}`);
    }

    return { 
      success: true, 
      invitationId, 
      simulated: (emailResult as any).simulated || false 
    };
  });
}
