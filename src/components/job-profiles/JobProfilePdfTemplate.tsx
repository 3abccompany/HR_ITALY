
import React from 'react';
import { Page, Text, View, Document, StyleSheet } from '@react-pdf/renderer';
import { JobProfile } from '@/types/job-profile';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'Helvetica',
    fontSize: 10,
    lineHeight: 1.5,
    color: '#1a1a1a',
  },
  header: {
    marginBottom: 20,
    borderBottomWidth: 3,
    borderBottomColor: '#1F1F66',
    paddingBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  companyName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1F1F66',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  docTitle: {
    fontSize: 22,
    fontWeight: 'heavy',
    color: '#1a1a1a',
  },
  metaContainer: {
    textAlign: 'right',
  },
  versionBadge: {
    backgroundColor: '#1F1F66',
    color: 'white',
    padding: '2 8',
    borderRadius: 4,
    fontSize: 9,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  dateText: {
    fontSize: 8,
    color: '#666',
  },
  recommendationBlock: {
    marginVertical: 15,
    padding: 15,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
    borderRadius: 8,
  },
  recommendationTitle: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#1F1F66',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  recommendationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  recommendationItem: {
    width: '25%',
    marginBottom: 5,
  },
  labelMini: {
    fontSize: 7,
    color: '#64748b',
    textTransform: 'uppercase',
  },
  valueMini: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  identityGrid: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 20,
  },
  identityBox: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#1F1F66',
    textTransform: 'uppercase',
    backgroundColor: '#f1f5f9',
    padding: '4 8',
    borderLeftWidth: 3,
    borderLeftColor: '#1F1F66',
    marginBottom: 8,
    marginTop: 15,
  },
  contentBlock: {
    marginBottom: 5,
  },
  listItem: {
    flexDirection: 'row',
    marginBottom: 4,
    paddingLeft: 10,
  },
  bullet: {
    width: 10,
    fontSize: 10,
  },
  listText: {
    flex: 1,
    fontSize: 9,
    color: '#334155',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    borderTopWidth: 0.5,
    borderTopColor: '#e2e8f0',
    paddingTop: 10,
    textAlign: 'center',
    fontSize: 7,
    color: '#94a3b8',
  },
  signatureContainer: {
    marginTop: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  signatureBox: {
    width: '40%',
    borderTopWidth: 1,
    borderTopColor: '#cbd5e1',
    paddingTop: 8,
    alignItems: 'center',
  },
  signatureLabel: {
    fontSize: 8,
    textTransform: 'uppercase',
    color: '#64748b',
  }
});

interface JobProfilePdfTemplateProps {
  profile: JobProfile;
}

export function JobProfilePdfTemplate({ profile }: JobProfilePdfTemplateProps) {
  const hasCcnl = !!(profile.defaultCcnlId && profile.defaultCcnlId !== "none_clear");

  const formatDate = (val: any) => {
    if (!val) return "N/A";
    const d = new Date(val);
    return d.toLocaleDateString('fr-FR');
  };

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>{profile.entityName}</Text>
            <Text style={styles.docTitle}>FICHE DE POSTE</Text>
          </View>
          <View style={styles.metaContainer}>
            <View style={styles.versionBadge}>
              <Text>{profile.versionLabel || "V1"}</Text>
            </View>
            <Text style={styles.dateText}>Émis le {formatDate(profile.issueDate)}</Text>
          </View>
        </View>

        {/* RH Recommendations */}
        {hasCcnl && (
          <View style={styles.recommendationBlock}>
            <Text style={styles.recommendationTitle}>Recommandations Contractuelles Internes</Text>
            <View style={styles.recommendationGrid}>
              <View style={styles.recommendationItem}>
                <Text style={styles.labelMini}>CCNL</Text>
                <Text style={styles.valueMini}>{profile.defaultCcnlName}</Text>
              </View>
              <View style={styles.recommendationItem}>
                <Text style={styles.labelMini}>Niveau</Text>
                <Text style={styles.valueMini}>{profile.defaultLevelCode || "-"}</Text>
              </View>
              <View style={styles.recommendationItem}>
                <Text style={styles.labelMini}>Contrat</Text>
                <Text style={styles.valueMini}>{profile.defaultContractType || "-"}</Text>
              </View>
              <View style={styles.recommendationItem}>
                <Text style={styles.labelMini}>Temps</Text>
                <Text style={styles.valueMini}>{profile.defaultWeeklyHours ? `${profile.defaultWeeklyHours}h/sem` : "-"}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Identity Section */}
        <View style={styles.identityGrid}>
          <View style={styles.identityBox}>
            <Text style={styles.labelMini}>Département</Text>
            <Text style={[styles.valueMini, { fontSize: 12 }]}>{profile.departmentName}</Text>
          </View>
          <View style={styles.identityBox}>
            <Text style={styles.labelMini}>Intitulé du poste</Text>
            <Text style={[styles.valueMini, { fontSize: 12, color: '#1F1F66' }]}>{profile.jobTitleName}</Text>
          </View>
        </View>

        {/* Hierarchical Context */}
        <View style={{ flexDirection: 'row', gap: 20, marginBottom: 10 }}>
           <View style={{ flex: 1 }}>
              <Text style={styles.labelMini}>Supérieur Hiérarchique (N+1)</Text>
              <Text style={styles.valueMini}>{profile.directSupervisorJobTitleName || "Non spécifié"}</Text>
           </View>
           <View style={{ flex: 1 }}>
              <Text style={styles.labelMini}>Équipes / Collaborateurs</Text>
              <Text style={styles.valueMini}>
                {profile.collaboratorJobTitleNames?.length > 0 ? profile.collaboratorJobTitleNames.join(', ') : "Aucun"}
              </Text>
           </View>
        </View>

        {/* Main Content Sections */}
        <View style={styles.contentBlock}>
          <Text style={styles.sectionTitle}>Missions & Responsabilités</Text>
          {profile.missionsAndResponsibilities?.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.listText}>{item}</Text>
            </View>
          ))}
        </View>

        <View style={styles.contentBlock}>
          <Text style={styles.sectionTitle}>Objectifs du poste</Text>
          {profile.objectives?.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={styles.bullet}>-</Text>
              <Text style={styles.listText}>{item}</Text>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 20 }}>
           <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Formation requise</Text>
              {profile.initialAndProfessionalTraining?.map((item, i) => (
                <Text key={i} style={[styles.listText, { marginBottom: 3 }]}>• {item}</Text>
              ))}
           </View>
           <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Expérience</Text>
              {profile.professionalExperience?.map((item, i) => (
                <Text key={i} style={[styles.listText, { marginBottom: 3 }]}>• {item}</Text>
              ))}
           </View>
        </View>

        <View style={styles.contentBlock}>
          <Text style={styles.sectionTitle}>Savoir-être (Soft Skills)</Text>
          <Text style={[styles.listText, { paddingLeft: 8 }]}>
             {profile.softSkills?.join(' • ') || "Non spécifié"}
          </Text>
        </View>

        {/* Signature Area */}
        <View style={styles.signatureContainer}>
           <View style={styles.signatureBox}>
              <Text style={styles.signatureLabel}>Responsable Hiérarchique</Text>
           </View>
           <View style={styles.signatureBox}>
              <Text style={styles.signatureLabel}>Salarié (Lu et approuvé)</Text>
           </View>
        </View>

        <Text style={styles.footer}>
          Document généré par HR Nexus Studio — ID: {profile.jobProfileId} — Page 1/1
        </Text>
      </Page>
    </Document>
  );
}
