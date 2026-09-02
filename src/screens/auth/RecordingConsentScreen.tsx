import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';

export interface RecordingConsentScreenProps {
  readonly onGrantConsent?: () => void;
  readonly onNotNow?: () => void;
}

const RecordingConsentScreen: React.FC<RecordingConsentScreenProps & { navigation?: any }> = ({
  onGrantConsent,
  onNotNow,
  navigation,
}) => {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Feather name="truck" size={24} color={colors.primary} />
          <Text style={styles.headerTitle}>Pick Up</Text>
        </View>
        <View style={styles.iconButton}>
          <Feather name="user" size={24} color={colors.outline} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* State 1: Consent Required */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.iconContainer}>
              <Feather name="video" size={24} color={colors.onPrimaryContainer} />
            </View>
            <Text style={styles.cardTitle}>Trip Recording Consent</Text>
          </View>
          
          <View style={styles.cardBody}>
            <Text style={styles.bodyText}>
              To enhance safety and facilitate dispute resolution, this trip supports secure audio and video recording during transit.
            </Text>
            
            <View style={styles.bulletList}>
              {[
                'Recordings are encrypted and stored securely.',
                'Only accessed in the event of a reported safety incident.',
                'You will be notified clearly when recording is active.'
              ].map((item, index) => (
                <View key={index} style={styles.bulletRow}>
                  <Feather name="check-circle" size={16} color={colors.primary} style={{ marginTop: 2 }} />
                  <Text style={styles.bulletText}>{item}</Text>
                </View>
              ))}
            </View>
            
            <Text style={styles.footnote}>
              Your consent is required to enable this feature for the current trip.
            </Text>
          </View>

          <View style={styles.actionRow}>
            <Pressable
              style={styles.primaryButton}
              onPress={() => {
                onGrantConsent?.();
                navigation?.navigate('CreateProfileScreen');
              }}
            >
              <Text style={styles.primaryButtonText}>Grant Consent</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                onNotNow?.();
                navigation?.navigate('CreateProfileScreen');
              }}
            >
              <Text style={styles.secondaryButtonText}>Not Now</Text>
            </Pressable>
          </View>
        </View>

        {/* State 2: Recording Active (Indicator in UI) */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>ACTIVE TRIP STATUS</Text>
          <View style={styles.statusBox}>
            <View style={styles.statusLeft}>
              <Feather name="map" size={24} color={colors.onSurfaceVariant} />
              <View>
                <Text style={styles.tripId}>TRP-8924-NY</Text>
                <Text style={styles.tripStatus}>In Transit</Text>
              </View>
            </View>
            
            <View style={styles.recordingBadge}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>Recording</Text>
            </View>
          </View>
        </View>

        {/* State 3: Recording Unavailable/Error */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>SYSTEM STATUS: UNAVAILABLE</Text>
          <View style={styles.unavailableBox}>
            <Feather name="video-off" size={24} color={colors.onSurfaceVariant} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.unavailableTitle}>Recording Not Supported</Text>
              <Text style={styles.unavailableDesc}>
                This vehicle or trip type does not currently support secure recording. Standard tracking remains active.
              </Text>
            </View>
          </View>
        </View>

        {/* State 4: Confirmations */}
        <View style={styles.gridContainer}>
          <View style={styles.smallCard}>
            <View style={styles.smallIconAccepted}>
              <Feather name="check" size={20} color={colors.onSecondaryContainer} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.smallCardTitle}>Consent Recorded</Text>
              <Text style={styles.smallCardDesc}>Recording will start when trip begins.</Text>
            </View>
          </View>

          <View style={styles.smallCard}>
            <View style={styles.smallIconStopped}>
              <Feather name="square" size={16} color={colors.onSurfaceVariant} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.smallCardTitle}>Recording Stopped</Text>
              <Text style={styles.smallCardDesc}>Session securely finalized.</Text>
            </View>
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surfaceContainerLow,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.sm,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.lg,
    gap: spacing.xl,
  },

  // Cards
  card: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    flexDirection: 'column',
    gap: spacing.lg,
    ...shadows.card,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  cardBody: {
    gap: spacing.md,
  },
  bodyText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  bulletList: {
    gap: spacing.sm,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  bulletText: {
    flex: 1,
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  footnote: {
    fontSize: 12,
    color: colors.outline,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: spacing.xs,
  },

  // Actions
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  primaryButton: {
    flex: 1,
    height: 48,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.labelSm.fontFamily,
  },
  secondaryButton: {
    flex: 1,
    height: 48,
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.labelSm.fontFamily,
  },

  // Status indicators
  sectionLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.outline,
    fontFamily: typography.labelCaps.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHigh,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  tripId: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.labelSm.fontFamily,
  },
  tripStatus: {
    fontSize: 12,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  recordingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.errorContainer,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.error,
  },
  recordingText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onErrorContainer,
    fontFamily: typography.labelSm.fontFamily,
  },

  // Unavailable
  unavailableBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  unavailableTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  unavailableDesc: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 4,
  },

  // Grid
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  smallCard: {
    flex: 1,
    minWidth: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    ...shadows.card,
  },
  smallIconAccepted: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallIconStopped: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallCardTitle: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.labelSm.fontFamily,
  },
  smallCardDesc: {
    fontSize: 12,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 2,
  },
});

export default RecordingConsentScreen;
