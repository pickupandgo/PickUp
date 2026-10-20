import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { mockKycDocuments } from '../../data/mockData';
import { AppHeader } from '../../components/molecules/AppHeader';
import { VehicleCard } from '../../components/molecules/VehicleCard';
import { DocumentCard } from '../../components/molecules/DocumentCard';
import { StatusBadge } from '../../components/atoms/StatusBadge';
import { useI18n } from '../../i18n';
import { getSelectedVehicleId, getVehicleDetails, type VehicleDetails } from '../../state/vehicle';
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

export interface VehicleDocumentsScreenProps {
  readonly navigation: AccountScreenProps<'VehicleDocuments'>['navigation'];
  readonly testID?: string;
}

export const VehicleDocumentsScreen: React.FC<VehicleDocumentsScreenProps> = ({
  navigation,
  testID,
}) => {
  const { t } = useI18n();
  const [vehicle, setVehicle] = useState<VehicleDetails>(() => getVehicleDetails(null, t));

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      getSelectedVehicleId().then((id) => {
        if (isMounted) {
          setVehicle(getVehicleDetails(id, t));
        }
      });
      return () => {
        isMounted = false;
      };
    }, [t]),
  );

  // Filter vehicle-related docs
  const vehicleDocs = mockKycDocuments.filter(
    (d) => d.type === 'vehicle_rc' || d.type === 'insurance_policy' || d.type === 'vehicle_photos',
  );

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

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title={t('settings.vehicleDetails')}
        onBackPress={() => navigation.goBack()}
        showBackButton
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Vehicle info */}
        <View style={styles.vehicleSection}>
          <VehicleCard
            name={vehicle.displayName}
            registration={vehicle.registration}
            image={vehicle.image}
            status={mapDocStatus(vehicle.status)}
            statusLabel={vehicle.status === 'approved' ? t('common.approved') : vehicle.status}
          />
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>{t('vehicle.status')}</Text>
            <StatusBadge
              label={vehicle.status === 'approved' ? t('common.approved') : vehicle.status}
              variant={mapDocStatus(vehicle.status)}
            />
          </View>
        </View>

        {/* Vehicle documents */}
        <Text style={styles.sectionLabel}>{t('vehicle.documents')}</Text>

        {vehicleDocs.map((doc) => (
          <DocumentCard
            key={doc.id}
            label={getDocLabel(doc.type, doc.label)}
            status={mapDocStatus(doc.status)}
            statusLabel={getDocStatusLabel(doc.status)}
            rejectionReason={getRejectionReason(doc.rejectionReason)}
            onActionPress={
              doc.status === 'rejected' ? () => {} : undefined
            }
            actionLabel={doc.status === 'rejected' ? t('kyc.resubmit') : undefined}
          />
        ))}
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
  vehicleSection: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    padding: spacing.containerPadding,
    gap: spacing.containerPadding,
    ...shadows.sm,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusLabel: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  sectionLabel: {
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});

export default VehicleDocumentsScreen;
