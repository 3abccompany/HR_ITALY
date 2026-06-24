
'use server';

import { adminDb, adminAuth } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash, randomBytes } from "crypto";
import { sendEmployeeInvitationEmailAction } from "./email.service";

/**
 * @fileOverview Server-only service for managing employee user accounts and invitations.
 * Phase 1A: Employee Access Foundation.
 * Phase 1B: Account Activation & Password Definition.
 * Fix: Removed collectionGroup dependency. entityId is now passed via URL query param.
 */

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Invites an existing employee to activate their personal space.
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

    // 2. TOKEN GENERATION (Secure & URL-safe)
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(rawToken);
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
    const baseUrl = process.env.APP_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:9002";
    // FIX: Include entityId in query string to allow direct lookup without collectionGroup
    const activationLink = `${baseUrl}/activate/${rawToken}?entityId=${entityId}`;

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

/**
 * Retrieves a non-sensitive snippet of an invitation for UI verification.
 * Uses direct collection lookup within the provided entity tenant.
 */
export async function getInvitationSnippetAction(rawToken: string, entityId: string | null) {
  if (!rawToken || !entityId) {
    return { success: false, error: "Lien d'activation invalide ou incomplet." };
  }
  
  if (!adminDb) {
    console.error("[Get Invitation Snippet] Admin SDK not initialized.");
    return { success: false, error: "Service momentanément indisponible." };
  }
  
  const tokenHash = hashToken(rawToken);
  
  try {
    // Scoped query within entity sub-collection (No collectionGroup required)
    const snap = await adminDb.collection("entities").doc(entityId).collection("employeeInvitations")
      .where("tokenHash", "==", tokenHash)
      .limit(1)
      .get();
      
    if (snap.empty) {
      return { success: false, error: "Invitation introuvable ou expirée." };
    }
    
    const data = snap.docs[0].data();
    
    if (data.status !== "pending") return { success: false, error: "Cette invitation a déjà été utilisée." };
    if (data.expiresAt.toDate() < new Date()) return { success: false, error: "Ce lien a expiré." };

    const entitySnap = await adminDb.collection("entities").doc(entityId).get();
    const entityName = entitySnap.exists ? (entitySnap.data()?.nomEntreprise || "L'entreprise") : "L'entreprise";

    return { 
      success: true, 
      invitation: { 
        email: data.email,
        entityName
      } 
    };
  } catch (err: any) {
    console.error("[Get Invitation Snippet] Firestore Scoped Query Error:", err);
    return { success: false, error: "Erreur technique lors de la vérification de l'invitation." };
  }
}

/**
 * Main Activation logic (Phase 1B).
 * Direct tenant path lookup using provided entityId.
 */
export async function activateEmployeeAccountAction(rawToken: string, password: string, entityId: string | null) {
  if (!rawToken || !password || !entityId || !adminDb || !adminAuth) {
    return { success: false, error: "Données manquantes pour l'activation." };
  }

  const tokenHash = hashToken(rawToken);

  try {
    // 1. Find Invitation via direct path
    const inviteSnap = await adminDb.collection("entities").doc(entityId).collection("employeeInvitations")
      .where("tokenHash", "==", tokenHash)
      .limit(1)
      .get();
      
    if (inviteSnap.empty) throw new Error("Invitation introuvable.");
    const inviteDoc = inviteSnap.docs[0];
    const invite = inviteDoc.data();
    const email = invite.email;
    const employeeId = invite.employeeId;

    if (invite.status !== "pending") throw new Error("Invitation déjà utilisée.");
    if (invite.expiresAt.toDate() < new Date()) throw new Error("Lien expiré.");

    // 2. Auth User Resolution (Create or Link)
    let uid: string;
    try {
      const existingUser = await adminAuth.getUserByEmail(email);
      uid = existingUser.uid;
    } catch (authErr: any) {
      if (authErr.code === 'auth/user-not-found') {
        const newUser = await adminAuth.createUser({
          email,
          password,
          emailVerified: true,
        });
        uid = newUser.uid;
      } else {
        throw authErr;
      }
    }

    // 3. ATOMIC TRANSACTION
    await adminDb.runTransaction(async (transaction) => {
      const userRef = adminDb.collection("users").doc(uid);
      const membershipId = `${uid}_${entityId}`;
      const membershipRef = adminDb.collection("memberships").doc(membershipId);
      const employeeRef = adminDb.collection("entities").doc(entityId).collection("employees").doc(employeeId);
      const entityRef = adminDb.collection("entities").doc(entityId);
      
      const [userSnap, employeeSnap, entitySnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(employeeRef),
        transaction.get(entityRef)
      ]);

      if (!employeeSnap.exists) throw new Error("Document employé cible introuvable.");
      const empData = employeeSnap.data()!;
      const entityData = entitySnap.exists ? entitySnap.data() : null;

      // A. Global User Profile
      if (!userSnap.exists) {
        transaction.set(userRef, {
          uid,
          email,
          displayName: empData.displayName || `${empData.firstName} ${empData.lastName}`,
          firstName: empData.firstName || "",
          lastName: empData.lastName || "",
          platformRole: "user",
          status: "active",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          createdBy: "system:activation"
        });
      }

      // B. Entity Membership
      const resolvedEntityName = entityData?.nomEntreprise || entityData?.name || invite.entityName || "Entreprise";
      
      transaction.set(membershipRef, {
        membershipId,
        uid,
        userId: uid,
        entityId,
        entityName: resolvedEntityName,
        userDisplayName: empData.displayName || `${empData.firstName} ${empData.lastName}` || "Employé",
        userEmail: email,
        roleId: "employee",
        roleLabel: "Employé",
        permissions: ["self.profile.read", "self.leaves.read", "self.leaves.create"],
        status: "active",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: "system:activation"
      }, { merge: true });

      // C. Update Employee Document
      transaction.update(employeeRef, {
        userId: uid,
        accountStatus: "active",
        activatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });

      // D. Finalize Invitation
      transaction.update(inviteDoc.ref, {
        status: "accepted",
        acceptedAt: FieldValue.serverTimestamp(),
        acceptedByUid: uid
      });

      // E. Timeline Event
      const timelineRef = adminDb.collection("entities").doc(entityId).collection("personTimeline").doc();
      transaction.set(timelineRef, {
        eventId: timelineRef.id,
        entityId,
        personId: empData.personId,
        type: "account.activated",
        label: "Compte activé",
        description: "L'employé a activé son accès à l'Espace Employé.",
        sourceCollection: "employeeInvitations",
        sourceId: invite.id,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: "system:activation"
      });
    });

    return { success: true };
  } catch (err: any) {
    console.error("[Activate Account Action] Error:", err.message);
    return { success: false, error: err.message || "Échec de l'activation." };
  }
}
