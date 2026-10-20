import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { AppHeader } from '../../components/molecules/AppHeader';
import { StatusBadge } from '../../components/atoms/StatusBadge';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
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

export interface VehicleStatusScreenProps {
  readonly navigation: AccountScreenProps<'VehicleStatus'>['navigation'];
  readonly testID?: string;
}

export const VehicleStatusScreen: React.FC<VehicleStatusScreenProps> = ({
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

  const getStatusText = (status: DocumentStatus): string => {
    switch (status) {
      case 'approved': return t('vehicle.approved');
      case 'rejected': return t('vehicle.rejected');
      case 'under_review': return t('vehicle.underReview');
      case 'pending': return t('vehicle.pending');
      case 'expired': return t('common.expired');
      default: return status;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title={t('vehicle.statusDetails')}
        onBackPress={() => navigation.goBack()}
        showBackButton
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Vehicle identity */}
        <View style={styles.card}>
          <View style={styles.vehicleIcon}>
            {vehicle.image ? (
              <Image source={vehicle.image} style={styles.vehicleImage} resizeMode="contain" fadeDuration={0} />
            ) : (
              <Icon name="local_shipping" size={32} color={colors.primary} />
            )}
          </View>
          <Text style={styles.vehicleName}>{vehicle.displayName}</Text>
          <Text style={styles.vehicleReg}>{vehicle.registration}</Text>
          <StatusBadge label={getStatusText(vehicle.status)} variant={mapDocStatus(vehicle.status)} />
        </View>

        {/* Status details */}
        <View style={styles.detailCard}>
          <Text style={styles.detailTitle}>{t('vehicle.statusDetails')}</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('vehicle.type')}</Text>
            <Text style={styles.detailValue}>{vehicle.displayName}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('vehicle.registration')}</Text>
            <Text style={styles.detailValue}>{vehicle.registration}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('vehicle.approvalStatus')}</Text>
            <Text style={[
              styles.detailValue,
              vehicle.status === 'approved' && styles.statusApproved,
              vehicle.status === 'rejected' && styles.statusRejected,
              vehicle.status === 'under_review' && styles.statusReview,
            ]}>
              {getStatusText(vehicle.status)}
            </Text>
          </View>
        </View>

        <PrimaryButton
          label={t('vehicle.changeVehicle')}
          onPress={() => navigation.navigate('VehicleSelection' as any)}
          style={styles.changeButton}
        />
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
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.gutter,
    ...shadows.sm,
  },
  vehicleIcon: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.xl,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    padding: 6,
  },
  vehicleImage: {
    width: 70,
    height: 70,
  },
  changeButton: {
    marginTop: spacing.md,
  },
  vehicleIconText: {
    fontSize: 32,
    color: colors.primary,
  },
  vehicleName: {
    ...typography.headlineMd,
    color: colors.onSurface,
  },
  vehicleReg: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  detailCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    padding: spacing.containerPadding,
    gap: spacing.gutter,
    ...shadows.sm,
  },
  detailTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  detailValue: {
    ...typography.bodyMd,
    fontWeight: '500',
    color: colors.onSurface,
  },
  statusApproved: {
    color: '#2e7d32',
  },
  statusRejected: {
    color: colors.error,
  },
  statusReview: {
    color: '#e65100',
  },
});

export default VehicleStatusScreen;
