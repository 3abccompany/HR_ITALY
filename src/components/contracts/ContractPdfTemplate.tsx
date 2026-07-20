import React from 'react';
import { Page, Text, View, Document, StyleSheet } from '@react-pdf/renderer';
import { Contract } from '@/types/contract';

const styles = StyleSheet.create({
  page: {
    padding: 60,
    fontFamily: 'Helvetica',
    fontSize: 10,
    lineHeight: 1.5,
    color: '#1a1a1a',
  },
  header: {
    marginBottom: 30,
    borderBottomWidth: 2,
    borderBottomColor: '#1F1F66',
    paddingBottom: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#1F1F66',
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 8,
    textAlign: 'center',
    color: '#666',
    marginBottom: 20,
  },
  section: {
    marginBottom: 15,
  },
  articleTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 8,
    textTransform: 'uppercase',
    color: '#1F1F66',
  },
  text: {
    marginBottom: 5,
    textAlign: 'justify',
  },
  bold: {
    fontWeight: 'bold',
  },
  signatureContainer: {
    marginTop: 50,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  signatureBox: {
    width: '45%',
    borderTopWidth: 1,
    borderTopColor: '#ccc',
    paddingTop: 10,
    alignItems: 'center',
  },
  signatureLabel: {
    fontSize: 8,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    color: '#666',
    marginBottom: 40,
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 60,
    right: 60,
    fontSize: 7,
    textAlign: 'center',
    color: '#999',
    borderTopWidth: 0.5,
    borderTopColor: '#eee',
    paddingTop: 5,
  }
});

interface ContractPdfTemplateProps {
  contract: Contract;
}

function safeText(value: unknown, fallback = 'Non renseigné') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function isIndefiniteContractType(contractType?: string | null) {
  const normalized = (contractType || '').toLowerCase();
  return ['tempo indeterminato', 'cdi', 'indeterminato'].some((label) =>
    normalized.includes(label)
  );
}

function formatDateSafe(dateStr?: string | null, fallback = 'da definire') {
  if (!dateStr || typeof dateStr !== 'string') return fallback;
  const [year, month, day] = dateStr.split('-');
  if (!year || !month || !day || Number.isNaN(Number(year)) || Number.isNaN(Number(month)) || Number.isNaN(Number(day))) {
    return fallback;
  }
  return `${day}/${month}/${year}`;
}

function formatMoneySafe(value?: number | string | null, fallback = 'Non renseigné') {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
    return fallback;
  }
  return numeric.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ContractPdfTemplate({ contract }: ContractPdfTemplateProps) {
  const companyName = safeText(contract.entityLegalName || contract.entityName, "L'azienda");
  const companyAddress = safeText(contract.companyAddressSnapshot);
  const vatNumber = safeText(contract.entityVatNumber);
  const legalRepresentative = safeText(contract.legalRepresentativeName);
  const employeeName = safeText(contract.employeeDisplayName);
  const employeeCode = safeText(contract.employeeCode || contract.contractId);
  const placeOfBirth = safeText(contract.placeOfBirth, '-');
  const dateOfBirth = formatDateSafe(contract.dateOfBirth);
  const employeeAddress = safeText(contract.employeeAddressSnapshot);
  const taxCode = safeText(contract.taxCode);
  const qualificationCategory = safeText(contract.qualificationCategory, 'Impiegato');
  const jobTitle = safeText(contract.jobTitleName);
  const departmentName = safeText(contract.departmentName);
  const contractType = safeText(contract.contractType, 'da definire');
  const startDate = formatDateSafe(contract.startDate);
  const isIndefinite = isIndefiniteContractType(contract.contractType);
  const durationSentence = isIndefinite
    ? 'Durata: tempo indeterminato, senza data di fine.'
    : `Il termine è fissato al ${formatDateSafe(contract.endDate, 'Data di fine non renseignée')}.`;
  const trialPeriodDays = safeText(contract.trialPeriodDays || 30);
  const worksiteName = safeText(contract.worksiteName);
  const ccnlName = safeText(contract.ccnlName);
  const levelLabel = [contract.levelCode, contract.levelLabel].filter(Boolean).join(' · ') || 'Non renseigné';
  const grossMonthly = formatMoneySafe(contract.grossMonthly);
  const grossAnnual = formatMoneySafe(contract.grossAnnual);
  const monthlyPayments = safeText(contract.monthlyPayments || 13);
  const weeklyHours = safeText(contract.weeklyHours);
  const workingScheduleNotes = safeText(contract.workingScheduleNotes, 'Non renseigné.');
  const partTimeSentence = contract.isPartTime ? ' in regime di Part-Time.' : ' in regime di Full-Time.';
  const uniLavProtocolNumber = safeText(contract.uniLavProtocolNumber, '');
  const uniLavSubmissionDate = formatDateSafe(contract.uniLavSubmissionDate, 'data non renseignée');
  const hasUniLavProtocol = uniLavProtocolNumber !== '';
  const missions = Array.isArray(contract.missionsSnapshot)
    ? contract.missionsSnapshot.filter((mission) => typeof mission === 'string' && mission.trim())
    : [];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Contratto Individuale di Lavoro</Text>
          <Text style={styles.subtitle}>HR Nexus Studio • Rif. Interno: {employeeCode}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 1 — Oggetto e Parti</Text>
          <Text style={styles.text}>
            Tra la società <Text style={styles.bold}>{companyName}</Text>, con sede legale in <Text style={styles.bold}>{companyAddress}</Text>, P.IVA/C.F. <Text style={styles.bold}>{vatNumber}</Text>, nella persona del suo legale rappresentante <Text style={styles.bold}>{legalRepresentative}</Text> (di seguito "Datore di Lavoro")
          </Text>
          <Text style={[styles.text, { marginTop: 5, marginBottom: 5, textAlign: 'center' }]}>e</Text>
          <Text style={styles.text}>
            il Sig./la Sig.ra <Text style={styles.bold}>{employeeName}</Text>, nato/a a <Text style={styles.bold}>{placeOfBirth}</Text> il <Text style={styles.bold}>{dateOfBirth}</Text>, residente in <Text style={styles.bold}>{employeeAddress}</Text>, C.F. <Text style={styles.bold}>{taxCode}</Text> (di seguito "Lavoratore")
          </Text>
          <Text style={styles.text}>Si stipula il presente contratto individuale di lavoro subordinato.</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 2 — Mansione e Qualifica</Text>
          <Text style={styles.text}>
            Il Lavoratore viene assunto con la qualifica di <Text style={styles.bold}>{qualificationCategory}</Text>, per lo svolgimento delle mansioni di <Text style={styles.bold}>{jobTitle}</Text> presso il dipartimento <Text style={styles.bold}>{departmentName}</Text>.
          </Text>
          {missions.length > 0 ? (
            <View style={{ marginLeft: 10, marginTop: 5 }}>
              {missions.map((mission, index) => (
                <Text key={`mission-${index}`} style={styles.text}>• {mission}</Text>
              ))}
            </View>
          ) : (
            <Text style={styles.text}>Mansioni dettagliate: Non renseigné.</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 3 — Durata del rapporto e Periodo di Prova</Text>
          <Text style={styles.text}>
            Il rapporto di lavoro decorre dal <Text style={styles.bold}>{startDate}</Text> ed è stipulato a <Text style={styles.bold}>{contractType}</Text>. {durationSentence}
          </Text>
          <Text style={styles.text}>
            Il periodo di prova è stabilito in <Text style={styles.bold}>{trialPeriodDays} giorni</Text> di effettivo lavoro. Durante tale periodo ciascuna delle parti potrà recedere dal contratto senza obbligo di preavviso o indennità.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 4 — Luogo di lavoro</Text>
          <Text style={styles.text}>
            La prestazione lavorativa sarà svolta ordinariamente presso la sede di <Text style={styles.bold}>{worksiteName}</Text>.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 5 — Trattamento Economico e CCNL</Text>
          <Text style={styles.text}>
            Al rapporto di lavoro si applicano le norme del <Text style={styles.bold}>{ccnlName}</Text>. L'inquadramento è fissato al <Text style={styles.bold}>Livello {levelLabel}</Text>.
          </Text>
          <Text style={styles.text}>
            La retribuzione lorda mensile è stabilita in <Text style={styles.bold}>€ {grossMonthly}</Text>, per <Text style={styles.bold}>{monthlyPayments} mensilità</Text>, corrispondente ad una RAL (Retribuzione Annua Lorda) di <Text style={styles.bold}>€ {grossAnnual}</Text>.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 6 — Orario di lavoro</Text>
          <Text style={styles.text}>
            L'orario di lavoro è fissato in <Text style={styles.bold}>{weeklyHours} ore settimanali</Text>{partTimeSentence}
          </Text>
          <Text style={styles.text}>Note organizzative: {workingScheduleNotes}</Text>
        </View>

        {hasUniLavProtocol ? (
          <View style={styles.section}>
            <Text style={styles.articleTitle}>Art. 7 — Comunicazioni Obbligatorie</Text>
            <Text style={styles.text}>
              Si dà atto che il Datore di Lavoro ha provveduto alla comunicazione obbligatoria di assunzione (UniLav) con protocollo n. <Text style={styles.bold}>{uniLavProtocolNumber}</Text> in data <Text style={styles.bold}>{uniLavSubmissionDate}</Text>.
            </Text>
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.articleTitle}>Art. 7 — Comunicazioni Obbligatorie</Text>
            <Text style={styles.text}>Protocollo UniLav non ancora renseigné nel dossier.</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 8 — Ferie, Permessi, ROL ed ex Festività</Text>
          <Text style={styles.text}>
            Il diritto alle ferie matura in proporzione alla durata del rapporto. Ferie, permessi, ROL ed ex festività sono regolati dal CCNL applicato. Le richieste devono essere presentate con congruo anticipo e sono soggette ad autorizzazione aziendale.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 9 — Malattia e Infortunio</Text>
          <Text style={styles.text}>
            In caso di malattia o infortunio, il Lavoratore dovrà darne tempestiva comunicazione al Datore di Lavoro e attenersi alle disposizioni di legge e del CCNL applicato in materia di certificazione e reperibilità.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 10 — Formazione e Sicurezza sul Lavoro</Text>
          <Text style={styles.text}>
            Il Datore di Lavoro garantisce la formazione obbligatoria in materia di salute e sicurezza sul lavoro ai sensi del D.Lgs. 81/2008. Il Lavoratore è tenuto a rispettare tutte le disposizioni aziendali in materia di sicurezza e prevenzione.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 11 — Contributi e Assicurazioni</Text>
          <Text style={styles.text}>
            Il Datore di Lavoro provvede agli adempimenti contributivi e assicurativi obbligatori nei confronti di INPS e INAIL, secondo la normativa vigente.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 12 — Comunicazioni Aziendali</Text>
          <Text style={styles.text}>
            Le comunicazioni di servizio potranno avvenire anche tramite posta elettronica all'indirizzo indicato dal Lavoratore. Restano esclusi gli atti per i quali la legge o il CCNL richiedono forme specifiche.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 13 — Obbligo di Fedeltà</Text>
          <Text style={styles.text}>
            Il Lavoratore è tenuto al rispetto dell'art. 2105 c.c., astenendosi da attività in concorrenza o comunque lesive degli interessi del Datore di Lavoro.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 14 — Riservatezza</Text>
          <Text style={styles.text}>
            Il Lavoratore si impegna a mantenere la massima riservatezza su dati, informazioni e notizie aziendali di cui venga a conoscenza nello svolgimento dell'attività lavorativa.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 15 — Regolamento interno, Codice disciplinare e Procedure Aziendali</Text>
          <Text style={styles.text}>
            Il Lavoratore dichiara di aver preso visione del Regolamento interno, del Codice disciplinare e delle procedure aziendali, di conoscerne il contenuto e di impegnarsi a rispettarli integralmente per tutta la durata del rapporto di lavoro. Tali documenti costituiscono parte integrante del presente contratto.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 16 — Trattamento dei Dati Personali</Text>
          <Text style={styles.text}>
            Il trattamento dei dati personali avverrà nel rispetto del Regolamento UE 2016/679 (GDPR) e della normativa nazionale applicabile, esclusivamente per finalità connesse alla gestione del rapporto di lavoro.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 17 — Clausola Finale</Text>
          <Text style={styles.text}>
            Per quanto non espressamente previsto dal presente contratto si applicano le disposizioni di legge, il CCNL applicato, il Regolamento interno e gli eventuali accordi aziendali vigenti.
          </Text>
        </View>

        <View style={{ marginTop: 40 }}>
          <Text style={styles.text}>Letto, confermato e sottoscritto.</Text>
          <Text style={[styles.text, { marginTop: 10 }]}>Luogo e data: ________________________, lì {new Date().toLocaleDateString('it-IT')}</Text>
        </View>

        <View style={styles.signatureContainer}>
          <View style={styles.signatureBox}>
            <Text style={styles.signatureLabel}>Per il Datore di Lavoro</Text>
          </View>
          <View style={styles.signatureBox}>
            <Text style={styles.signatureLabel}>Il Lavoratore</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          Documento generato automaticamente da HR Nexus Studio per {companyName}. ID Documento: {safeText(contract.contractId)} - Versione PDF: {safeText(contract.generatedPdfVersion || 1)}
        </Text>
      </Page>
    </Document>
  );
}
