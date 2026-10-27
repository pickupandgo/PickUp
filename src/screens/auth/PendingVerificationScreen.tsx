import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { AppHeader } from '../../components/molecules/AppHeader';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { SecondaryButton } from '../../components/atoms/SecondaryButton';
import Icon from '../../components/atoms/Icon';
import { AuthService } from '../../services/auth/AuthService';
import { useI18n } from '../../i18n';
import type { AuthScreenProps } from '../../types/navigation';
import { getDriverVehicleProfile } from '../../state/vehicle';

export interface PendingVerificationScreenProps {
  readonly navigation: any;
  readonly route?: any;
  readonly testID?: string;
}

export const PendingVerificationScreen: React.FC<PendingVerificationScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { t } = useI18n();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [profile, setProfile] = useState<any>(route?.params || {});

  const loadProfile = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const authService = AuthService.getInstance();
      if (authService.fetchDriverProfile) {
        const backendProfile = await authService.fetchDriverProfile();
        if (backendProfile) {
          setProfile(backendProfile);
          if (backendProfile.approvalStatus === 'APPROVED') {
            Alert.alert(
              'Account Approved!',
              'Your driver registration has been verified and approved.',
              [
                {
                  text: 'Continue',
                  onPress: () => {
                    if (navigation.canGoBack()) {
                      navigation.popToTop();
                    } else if (navigation.replace) {
                      navigation.replace('LanguageSelection');
                    }
                  },
                },
              ],
            );
          }
        } else {
          // If backend profile is null (unregistered), guide to registration
          navigation.navigate('DriverRegistration', { phone: profile?.phone });
        }
      }
    } catch (err: any) {
      console.warn('[PENDING] Failed to refresh profile:', err?.message);
    } finally {
      setIsRefreshing(false);
    }
  }, [navigation]);

  useEffect(() => {
    // If vehicle details weren't passed in route params, check local store
    if (!profile.vehicleType || !profile.vehicleRegistrationNumber) {
      getDriverVehicleProfile().then((localProfile) => {
        if (localProfile) {
          setProfile((prev: any) => ({
            ...prev,
            vehicleType: prev.vehicleType || localProfile.vehicleType,
            vehicleRegistrationNumber: prev.vehicleRegistrationNumber || localProfile.vehicleRegistrationNumber,
            vehicleMakeModel: prev.vehicleMakeModel || localProfile.vehicleMakeModel,
          }));
        }
      }).catch(() => {});
    }
  }, [profile.vehicleType, profile.vehicleRegistrationNumber]);

  const handleLogout = useCallback(async () => {
    try {
      await AuthService.getInstance().logout();
    } catch (e: any) {
      console.warn('[AUTH] Logout failed:', e?.message);
    }
  }, []);

  const handleContactSupport = useCallback(() => {
    Alert.alert(
      'MultiRide Support',
      'For assistance with your driver registration or document verification, contact support at support@multiride.com or call our partner helpline.',
      [{ text: 'OK' }],
    );
  }, []);

  const approvalStatus = (profile.approvalStatus || 'PENDING').toUpperCase();
  const isApproved = approvalStatus === 'APPROVED';
  const isRejected = approvalStatus === 'REJECTED';
  const isSuspended = approvalStatus === 'SUSPENDED';

  const statusColor = isApproved ? colors.primary : isRejected || isSuspended ? colors.error : colors.tertiary;

  return (
    <SafeAreaView style={styles.safeArea} testID={testID} edges={['top', 'bottom']}>
      <AppHeader
        title="Application Status"
        showBackButton={false}
        showDivider
      />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Hero Card */}
        <View style={styles.heroCard}>
          <View style={[styles.heroIconContainer, { backgroundColor: statusColor + '18' }]}>
            <Icon
              name={isApproved ? 'check_circle' : isRejected ? 'cancel' : isSuspended ? 'lock' : 'hourglass_top'}
              size={36}
              color={statusColor}
            />
          </View>
          <Text style={styles.heroTitle}>
            {isApproved
              ? 'Application Approved!'
              : isRejected
              ? 'Application Rejected'
              : isSuspended
              ? 'Account Suspended'
              : 'Registration Under Review'}
          </Text>
          <Text style={styles.heroSubtitle}>
            {isApproved
              ? 'Your driver account has been verified and approved. You are ready to accept rides!'
              : isRejected
              ? 'Your application could not be approved at this time. Please contact support.'
              : isSuspended
              ? 'Your driver account has been temporarily suspended from accepting rides.'
              : 'Your registration details have been received and are pending administrative verification.'}
          </Text>

          <View style={[styles.statusBadge, { borderColor: statusColor, backgroundColor: statusColor + '14' }]}>
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>
              STATUS: {approvalStatus}
            </Text>
          </View>
        </View>

        {/* Registered Details */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Application Details</Text>

          {profile.legalName ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Driver Name</Text>
              <Text style={styles.detailValue}>{profile.legalName}</Text>
            </View>
          ) : null}

          {profile.phone ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Mobile Number</Text>
              <Text style={styles.detailValue}>{profile.phone}</Text>
            </View>
          ) : null}

          {profile.vehicleType ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Vehicle Category</Text>
              <Text style={styles.detailValue}>{profile.vehicleType}</Text>
            </View>
          ) : null}

          {profile.vehicleRegistrationNumber ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Vehicle Number</Text>
              <Text style={styles.detailValue}>{profile.vehicleRegistrationNumber}</Text>
            </View>
          ) : null}

          {profile.vehicleMakeModel ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Make & Model</Text>
              <Text style={styles.detailValue}>{profile.vehicleMakeModel}</Text>
            </View>
          ) : null}
        </View>

        {/* Verification Info */}
        <View style={styles.infoCard}>
          <Icon name="info" size={20} color={colors.primary} style={styles.infoIcon} />
          <View style={styles.infoContent}>
            <Text style={styles.infoTitle}>Verification Instructions</Text>
            <Text style={styles.infoText}>
              MultiRide requires driver partner identity and vehicle verification before rides can be accepted. Once your profile and documents are approved by our operations team, ride requests and payouts will automatically be enabled.
            </Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionContainer}>
          {isApproved ? (
            <PrimaryButton
              label="Continue to App"
              onPress={() => {
                if (navigation.canGoBack()) {
                  navigation.popToTop();
                } else if (navigation.replace) {
                  navigation.replace('LanguageSelection');
                }
              }}
              style={styles.refreshBtn}
            />
          ) : (
            <PrimaryButton
              label={isRefreshing ? 'Checking...' : 'Check Verification Status'}
              onPress={loadProfile}
              loading={isRefreshing}
              style={styles.refreshBtn}
            />
          )}
          <SecondaryButton
            label="Contact Partner Support"
            onPress={handleContactSupport}
            style={styles.supportBtn}
          />
          <SecondaryButton
            label="Log Out"
            onPress={handleLogout}
            style={styles.logoutBtn}
          />
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
    padding: spacing.md,
    gap: spacing.md,
  },
  heroCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  heroIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  heroTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  heroSubtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  statusBadge: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  statusBadgeText: {
    ...typography.labelSm,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    gap: spacing.sm,
  },
  cardTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.outlineVariant,
  },
  detailLabel: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  detailValue: {
    ...typography.bodyMd,
    color: colors.onSurface,
    fontWeight: '600',
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    gap: spacing.sm,
  },
  infoIcon: {
    marginTop: 2,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
    fontWeight: '600',
    marginBottom: 2,
  },
  infoText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    lineHeight: 18,
  },
  actionContainer: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  refreshBtn: {
    marginBottom: spacing.xs,
  },
  supportBtn: {
    marginBottom: spacing.xs,
  },
  logoutBtn: {
    marginBottom: spacing.sm,
  },
});

export default PendingVerificationScreen;
