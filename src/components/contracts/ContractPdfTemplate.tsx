import React from 'react';
import { Page, Text, View, Document, StyleSheet, Font } from '@react-pdf/renderer';
import { Contract } from '@/types/contract';

// Register standard fonts
// Note: In server-side rendering, standard fonts are usually available.
// If custom fonts are needed, they would need to be loaded via public URLs.

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

export function ContractPdfTemplate({ contract }: ContractPdfTemplateProps) {
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'da definire';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  };

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Contratto Individuale di Lavoro</Text>
          <Text style={styles.subtitle}>HR Nexus Studio • Rif. Interno: {contract.employeeCode || contract.contractId}</Text>
        </View>

        {/* Art 1 - Parti */}
        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 1 — Oggetto e Parti</Text>
          <Text style={styles.text}>
            Tra la società <Text style={styles.bold}>{contract.entityLegalName || contract.entityName}</Text>, 
            con sede legale in <Text style={styles.bold}>{contract.companyAddressSnapshot}</Text>, 
            P.IVA/C.F. <Text style={styles.bold}>{contract.entityVatNumber}</Text>, 
            nella persona del suo legale rappresentante <Text style={styles.bold}>{contract.legalRepresentativeName}</Text> (di seguito "Datore di Lavoro")
          </Text>
          <Text style={[styles.text, { marginTop: 5, marginBottom: 5, textAlign: 'center' }]}>e</Text>
          <Text style={styles.text}>
            il Sig./la Sig.ra <Text style={styles.bold}>{contract.employeeDisplayName}</Text>, 
            nato/a a <Text style={styles.bold}>{contract.placeOfBirth || '-'}</Text> il <Text style={styles.bold}>{formatDate(contract.dateOfBirth)}</Text>, 
            residente in <Text style={styles.bold}>{contract.employeeAddressSnapshot}</Text>, 
            C.F. <Text style={styles.bold}>{contract.taxCode}</Text> (di seguito "Lavoratore")
          </Text>
          <Text style={styles.text}>Si stipula il presente contratto individuale di lavoro subordinato.</Text>
        </View>

        {/* Art 2 - Inquadramento */}
        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 2 — Mansione e Qualifica</Text>
          <Text style={styles.text}>
            Il Lavoratore viene assunto con la qualifica di <Text style={styles.bold}>{contract.qualificationCategory || 'Impiegato'}</Text>, 
            per lo svolgimento delle mansioni di <Text style={styles.bold}>{contract.jobTitleName}</Text> presso il dipartimento <Text style={styles.bold}>{contract.departmentName}</Text>.
          </Text>
          {contract.missionsSnapshot && contract.missionsSnapshot.length > 0 && (
            <View style={{ marginLeft: 10, marginTop: 5 }}>
              {contract.missionsSnapshot.map((m, i) => (
                <Text key={i} style={styles.text}>• {m}</Text>
              ))}
            </View>
          )}
        </View>

        {/* Art 3 - Durata e Prova */}
        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 3 — Durata del rapporto e Periodo di Prova</Text>
          <Text style={styles.text}>
            Il rapporto di lavoro decorre dal <Text style={styles.bold}>{formatDate(contract.startDate)}</Text> ed è stipulato a 
            <Text style={styles.bold}> {contract.contractType}</Text>.
            {contract.endDate && <Text> Il termine è fissato al {formatDate(contract.endDate)}.</Text>}
          </Text>
          <Text style={styles.text}>
            Il periodo di prova è stabilito in <Text style={styles.bold}>{contract.trialPeriodDays || 30} giorni</Text> di effettivo lavoro. 
            Durante tale periodo ciascuna delle parti potrà recedere dal contratto senza obbligo di preavviso o indennità.
          </Text>
        </View>

        {/* Art 4 - Sede */}
        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 4 — Luogo di lavoro</Text>
          <Text style={styles.text}>
            La prestazione lavorativa sarà svolta ordinariamente presso la sede di <Text style={styles.bold}>{contract.worksiteName}</Text>.
          </Text>
        </View>

        {/* Art 5 - Trattamento Economico */}
        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 5 — Trattamento Economico e CCNL</Text>
          <Text style={styles.text}>
            Al rapporto di lavoro si applicano le norme del <Text style={styles.bold}>{contract.ccnlName}</Text>. 
            L'inquadramento è fissato al <Text style={styles.bold}>Livello {contract.levelCode}</Text>.
          </Text>
          <Text style={styles.text}>
            La retribuzione lorda mensile è stabilita in <Text style={styles.bold}>€ {contract.grossMonthly.toLocaleString('it-IT', { minimumFractionDigits: 2 })}</Text>, 
            per <Text style={styles.bold}>{contract.monthlyPayments || 13} mensilità</Text>, 
            corrispondente ad una RAL (Retribuzione Annua Lorda) di <Text style={styles.bold}>€ {contract.grossAnnual.toLocaleString('it-IT', { minimumFractionDigits: 2 })}</Text>.
          </Text>
        </View>

        {/* Art 6 - Orario */}
        <View style={styles.section}>
          <Text style={styles.articleTitle}>Art. 6 — Orario di lavoro</Text>
          <Text style={styles.text}>
            L'orario di lavoro è fissato in <Text style={styles.bold}>{contract.weeklyHours} ore settimanali</Text>
            {contract.isPartTime ? ' in regime di Part-Time.' : ' in regime di Full-Time.'}
          </Text>
          {contract.workingScheduleNotes && (
            <Text style={styles.text}>Note organizzative: {contract.workingScheduleNotes}</Text>
          )}
        </View>

        {/* Art 7 - Compliance */}
        {(contract.uniLavProtocolNumber) && (
          <View style={styles.section}>
            <Text style={styles.articleTitle}>Art. 7 — Comunicazioni Obbligatorie</Text>
            <Text style={styles.text}>
              Si dà atto che il Datore di Lavoro ha provveduto alla comunicazione obbligatoria di assunzione (UniLav) 
              con protocollo n. <Text style={styles.bold}>{contract.uniLavProtocolNumber}</Text> in data <Text style={styles.bold}>{contract.uniLavSubmissionDate}</Text>.
            </Text>
          </View>
        )}

        {/* Signatures */}
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

        {/* Footer */}
        <Text style={styles.footer}>
          Documento generato automaticamente da HR Nexus Studio per {contract.entityName}. 
          ID Documento: {contract.contractId} - Versione PDF: {contract.generatedPdfVersion || 1}
        </Text>
      </Page>
    </Document>
  );
}
