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
      label: "Documento di identità",
      description: "Carte d’identité ou passeport du candidat.",
      required: true,
      status: "requested",
    },
    {
      key: "tax_code_health_card",
      label: "Codice fiscale / Tessera sanitaria",
      description: "Code fiscal italien ou carte sanitaire.",
      required: true,
      status: "requested",
    },
    {
      key: "residence_permit",
      label: "Permesso di soggiorno",
      description: "Obligatoire uniquement pour les candidats non-UE.",
      required: false,
      conditional: true,
      conditionNote: "À rendre obligatoire si le candidat est non-UE.",
      status: "not_applicable",
    },
    {
      key: "iban",
      label: "IBAN / Coordinate bancarie",
      description: "Coordonnées bancaires pour la paie.",
      required: true,
      status: "requested",
    },
    {
      key: "residence_address",
      label: "Residenza / domicilio",
      description: "Adresse de résidence ou domicile.",
      required: true,
      status: "requested",
    },
    {
      key: "contact_confirmed",
      label: "Email e telefono confermati",
      description: "Email et téléphone confirmés.",
      required: true,
      status: "requested",
    },
    {
      key: "driving_license",
      label: "Patente",
      description: "Permis de conduire si nécessaire pour le poste.",
      required: false,
      status: "not_applicable",
    },
    {
      key: "safety_training",
      label: "Attestati formazione sicurezza",
      description: "Certificats de formation sécurité si déjà disponibles.",
      required: false,
      status: "not_applicable",
    },
    {
      key: "medical_fitness",
      label: "Idoneità sanitaria",
      description: "Document médical d’aptitude si requis par le poste.",
      required: false,
      status: "not_applicable",
    },
    {
      key: "professional_qualification",
      label: "Qualifica professionale",
      description: "Diplôme, qualification ou certification métier.",
      required: false,
      status: "not_applicable",
    },
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