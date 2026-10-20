import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { mockKycDocuments } from '../../data/mockData';
import { AppHeader } from '../../components/molecules/AppHeader';
import { DocumentCard } from '../../components/molecules/DocumentCard';
import { StatusPill } from '../../components/atoms/StatusPill';
import { useI18n } from '../../i18n';
import type { DocumentStatus } from '../../types/user';
import type { BadgeVariant } from '../../components/atoms/StatusBadge';
import type { AccountScreenProps } from '../../types/navigation';

const mapDocStatus = (status: DocumentStatus): BadgeVariant => {
  const map: Record<DocumentStatus, BadgeVariant> = {
    pending: 'pending',
    under_review: 'under_review',
    approved: 'approved',
    rejected: 'rejected',
    expired: 'expired',
  };
  return map[status];
};

export interface KYCDocumentsScreenProps {
  readonly navigation: AccountScreenProps<'KYCDocuments'>['navigation'];
  readonly testID?: string;
}

export const KYCDocumentsScreen: React.FC<KYCDocumentsScreenProps> = ({
  navigation,
  testID,
}) => {
  const { t } = useI18n();
  const documents = mockKycDocuments;
  const hasActionRequired = documents.some((d) => d.status === 'rejected' || d.status === 'pending');

  const getDocStatusLabel = (status: DocumentStatus): string => {
    switch (status) {
      case 'pending': return t('kyc.notUploaded');
      case 'under_review': return t('kyc.underReview');
      case 'approved': return t('kyc.verified');
      case 'rejected': return t('kyc.rejected');
      case 'expired': return t('kyc.expired');
      default: return status;
    }
  };

  const getDocLabel = (type: string, fallback: string): string => {
    switch (type) {
      case 'driving_license': return t('kyc.docDl');
      case 'aadhaar_card': return t('kyc.docAadhaar');
      case 'pan_card': return t('kyc.docPan');
      case 'vehicle_rc': return t('kyc.docRc');
      case 'insurance_policy': return t('kyc.docInsurance');
      case 'vehicle_photos': return t('kyc.docPhotos');
      default: return fallback;
    }
  };

  const getRejectionReason = (reason?: string): string | undefined => {
    if (!reason) return undefined;
    if (reason.includes('blurry or illegible')) {
      return t('kyc.rejectionBlurry');
    }
    return reason;
  };

  const handleResubmit = useCallback((_docId: string) => {
    // Mock: in production, opens camera/file picker via service layer
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title={t('kyc.title')}
        onBackPress={() => navigation.goBack()}
        showBackButton
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Action required banner */}
        {hasActionRequired ? (
          <View style={styles.warningBanner}>
            <Icon name="warning" style={styles.warningIcon} />
            <View style={styles.warningContent}>
              <Text style={styles.warningTitle}>{t('kyc.actionRequiredTitle')}</Text>
              <Text style={styles.warningSubtitle}>{t('kyc.actionRequiredSubtitle')}</Text>
            </View>
          </View>
        ) : null}

        {/* Documents list */}
        <Text style={styles.sectionLabel}>{t('kyc.requiredDocuments')}</Text>

        {documents.map((doc) => (
          <DocumentCard
            key={doc.id}
            label={getDocLabel(doc.type, doc.label)}
            status={mapDocStatus(doc.status)}
            statusLabel={getDocStatusLabel(doc.status)}
            rejectionReason={getRejectionReason(doc.rejectionReason)}
            onActionPress={
              doc.status === 'rejected' || doc.status === 'pending'
                ? () => handleResubmit(doc.id)
                : undefined
            }
            actionLabel={
              doc.status === 'rejected'
                ? t('kyc.resubmit')
                : doc.status === 'pending'
                ? t('kyc.upload')
                : undefined
            }
          />
        ))}

        {/* Verification note */}
        <View style={styles.noteRow}>
          <Icon name="info" style={styles.noteIcon} />
          <Text style={styles.noteText}>{t('kyc.verificationNote')}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  scrollContent: {
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.lg,
    gap: spacing.containerPadding,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.gutter,
    backgroundColor: '#fff3e0',
    borderRadius: borderRadius.md,
    padding: spacing.containerPadding,
    borderLeftWidth: 4,
    borderLeftColor: '#ff9800',
  },
  warningIcon: {
    fontSize: 24,
    color: '#e65100',
    marginTop: 2,
  },
  warningContent: {
    flex: 1,
    gap: 4,
  },
  warningTitle: {
    ...typography.bodyMd,
    fontWeight: '600',
    color: '#e65100',
  },
  warningSubtitle: {
    ...typography.labelSm,
    color: '#bf360c',
    lineHeight: 18,
  },
  sectionLabel: {
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.gutter,
  },
  noteIcon: {
    fontSize: 16,
    color: colors.outline,
  },
  noteText: {
    ...typography.labelSm,
    color: colors.outline,
    flex: 1,
  },
});

export default KYCDocumentsScreen;
