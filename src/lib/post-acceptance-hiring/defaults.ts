import type {
    HrNotificationSettings,
    ItalyComplianceSettings,
    PreHireDocumentChecklistItem,
  } from "@/types/post-acceptance-hiring";
  
  export const DEFAULT_HR_NOTIFICATION_SETTINGS: HrNotificationSettings = {
    notifyOnOfferAccepted: false,
    offerAcceptedRecipients: [],
    ccRecipients: [],
    bccRecipients: [],
  };
  
  export const DEFAULT_ITALY_COMPLIANCE_SETTINGS: ItalyComplianceSettings = {
    mandatoryCommunicationEnabled: false,
    consultantEmail: "",
    consultantName: "",
    sendConsultantEmailAutomatically: false,
    mode: "draft_only",
  };
  
  export const DEFAULT_PRE_HIRE_CHECKLIST: PreHireDocumentChecklistItem[] = [
    {
      key: "identity_document",
      label: "Carte d’identité",
      description: "Documento di identità in corso di validità.",
      required: true,
      status: "requested",
    },
    {
      key: "health_card",
      label: "Tessera sanitaria",
      description: "Copia della tessera sanitaria o codice fiscale.",
      required: true,
      status: "requested",
    },
    {
      key: "hiring_request",
      label: "Richiesta assunzione",
      description: "Richiesta di assunzione firmata.",
      required: true,
      status: "requested",
    }
  ];
  
  export function calculatePreHireReadiness(
    checklist: PreHireDocumentChecklistItem[]
  ) {
    const requiredItems = checklist.filter((item) => item.required);
  
    const approvedRequiredItems = requiredItems.filter(
      (item) => item.status === "approved" || item.status === "not_applicable"
    );
  
    return {
      requiredDocumentsCount: requiredItems.length,
      approvedRequiredDocumentsCount: approvedRequiredItems.length,
      readyForConversion:
        requiredItems.length > 0 &&
        approvedRequiredItems.length === requiredItems.length,
    };
  }
