export type UniLavAssunzioneAcceptanceMode = "candidate_portal" | "hr_direct" | "unknown";

export type UniLavAssunzioneEmailInput = {
  acceptanceMode?: UniLavAssunzioneAcceptanceMode | null;
  consultantName?: string | null;
  employeeFullName?: string | null;
  codiceFiscale?: string | null;
  birthDate?: string | null;
  birthPlace?: string | null;
  gender?: string | null;
  residenceAddress?: string | null;
  residenceCity?: string | null;
  residenceProvince?: string | null;
  residencePostalCode?: string | null;
  employeeEmail?: string | null;
  employeePhone?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  contractType?: string | null;
  workingTime?: string | null;
  weeklyHours?: string | number | null;
  workingSchedule?: string | null;
  trialPeriod?: string | number | null;
  ccnl?: string | null;
  level?: string | null;
  qualification?: string | null;
  department?: string | null;
  grossMonthly?: string | number | null;
  grossAnnual?: string | number | null;
  worksiteName?: string | null;
  worksiteAddress?: string | null;
  worksiteCity?: string | null;
  worksiteProvince?: string | null;
  worksitePostalCode?: string | number | null;
  employerLegalName?: string | null;
  employerCodiceFiscale?: string | null;
  employerVat?: string | null;
  employerRegisteredOffice?: string | null;
  employerPostalCode?: string | number | null;
  employerCity?: string | null;
  employerProvince?: string | null;
  employerPhone?: string | null;
  employerEmail?: string | null;
  employerPec?: string | null;
  employmentRequestId?: string | null;
  employmentOfferId?: string | null;
};

function clean(value: unknown) {
  if (value === null || value === undefined) return "";
  const normalized = String(value).trim();
  const lower = normalized.toLowerCase();
  const isPlaceholder = ["undefined", "null", "-", "non disponible", "non disponibile", "data da confermare", "collaboratore"].includes(lower);
  return normalized && !isPlaceholder ? normalized : "";
}

function pushLine(target: string[], label: string, value: unknown, suffix = "") {
  const normalized = clean(value);
  if (normalized) target.push(`- ${label} : ${normalized}${suffix}`);
}

export function buildUniLavAssunzioneConsultantEmail(input: UniLavAssunzioneEmailInput) {
  const employeeName = clean(input.employeeFullName);
  const startDate = clean(input.startDate);
  const subjectParts = ["Richiesta Comunicazione UniLav Assunzione", employeeName, startDate].filter(Boolean);
  const subject = subjectParts.join(" \u2014 ");

  const lines: string[] = [
    `Bonjour${clean(input.consultantName) ? ` ${clean(input.consultantName)}` : ""},`,
    "",
    "Merci de proc\u00e9der \u00e0 la communication UniLav relative \u00e0 l\u2019embauche suivante.",
    "",
  ];

  const employeeLines: string[] = [];
  pushLine(employeeLines, "Nom et prénom", employeeName);
  pushLine(employeeLines, "Codice fiscale", input.codiceFiscale);
  pushLine(employeeLines, "Date de naissance", input.birthDate);
  pushLine(employeeLines, "Lieu de naissance", input.birthPlace);
  pushLine(employeeLines, "Sexe", input.gender);
  pushLine(employeeLines, "Adresse / résidence", input.residenceAddress);
  pushLine(employeeLines, "Ville", input.residenceCity);
  pushLine(employeeLines, "Province", input.residenceProvince);
  pushLine(employeeLines, "Code postal", input.residencePostalCode);
  pushLine(employeeLines, "Email", input.employeeEmail);
  pushLine(employeeLines, "Téléphone", input.employeePhone);
  if (employeeLines.length) lines.push("SALARIÉ / LAVORATORE", ...employeeLines, "");

  const hiringLines: string[] = [];
  pushLine(hiringLines, "Date d'embauche / début", input.startDate);
  pushLine(hiringLines, "Type de contrat", input.contractType);
  pushLine(hiringLines, "Date de fin du contrat", input.endDate);
  pushLine(hiringLines, "Temps plein / temps partiel", input.workingTime);
  pushLine(hiringLines, "Heures hebdomadaires", input.weeklyHours, clean(input.weeklyHours) ? " h/semaine" : "");
  pushLine(hiringLines, "Horaire / organisation du travail", input.workingSchedule);
  pushLine(hiringLines, "Période d'essai", input.trialPeriod);
  pushLine(hiringLines, "CCNL", input.ccnl);
  pushLine(hiringLines, "Niveau", input.level);
  pushLine(hiringLines, "Qualification / fonction", input.qualification);
  pushLine(hiringLines, "Département / service", input.department);
  pushLine(hiringLines, "Rémunération brute mensuelle", input.grossMonthly);
  pushLine(hiringLines, "Rémunération brute annuelle", input.grossAnnual);
  if (hiringLines.length) lines.push("EMBAUCHE / RAPPORT DE TRAVAIL", ...hiringLines, "");

  const worksiteLines: string[] = [];
  pushLine(worksiteLines, "Site", input.worksiteName);
  pushLine(worksiteLines, "Adresse", input.worksiteAddress);
  pushLine(worksiteLines, "Ville", input.worksiteCity);
  pushLine(worksiteLines, "Province", input.worksiteProvince);
  pushLine(worksiteLines, "Code postal", input.worksitePostalCode);
  if (worksiteLines.length) lines.push("LIEU DE TRAVAIL", ...worksiteLines, "");

  const companyLines: string[] = [];
  pushLine(companyLines, "Raison sociale", input.employerLegalName);
  pushLine(companyLines, "Codice fiscale entreprise", input.employerCodiceFiscale);
  pushLine(companyLines, "Partita IVA / numéro TVA", input.employerVat);
  pushLine(companyLines, "Adresse siège", input.employerRegisteredOffice);
  pushLine(companyLines, "Code postal", input.employerPostalCode);
  pushLine(companyLines, "Ville", input.employerCity);
  pushLine(companyLines, "Province", input.employerProvince);
  pushLine(companyLines, "Téléphone", input.employerPhone);
  pushLine(companyLines, "Email", input.employerEmail);
  pushLine(companyLines, "PEC", input.employerPec);
  if (companyLines.length) lines.push("ENTREPRISE / DATORE DI LAVORO", ...companyLines, "");

  const dossierLines: string[] = [];
  pushLine(dossierLines, "Référence demande", input.employmentRequestId);
  pushLine(dossierLines, "Référence offre", input.employmentOfferId);
  pushLine(dossierLines, "Consultant", input.consultantName);
  if (dossierLines.length) lines.push("DOSSIER", ...dossierLines, "");

  lines.push(
    "Merci de nous transmettre la confirmation de la communication UniLav ainsi que le numéro de protocole dès disponibilité.",
    "",
    "Cordialement,"
  );

  return { subject, body: lines.join("\n") };
}
