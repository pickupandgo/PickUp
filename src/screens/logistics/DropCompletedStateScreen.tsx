import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';
import { mockActiveTrip } from '../../data/mockData';

export interface DropCompletedStateScreenProps {
  readonly onBack?: () => void;
  readonly onHelp?: () => void;
  readonly onTrackNextStop?: () => void;
}

const DropCompletedStateScreen: React.FC<DropCompletedStateScreenProps & { navigation?: any }> = ({
  onBack,
  onHelp,
  onTrackNextStop,
  navigation,
}) => {
  const currentDrop = mockActiveTrip.stops[1]; // Drop 1 in the data
  const nextDrop = mockActiveTrip.stops[2]; // Drop 2 in the data

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
          accessibilityRole="button"
        >
          <Feather name="arrow-left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Trip Progress</Text>
        <Pressable
          style={styles.helpButton}
          onPress={() => (onHelp ? onHelp() : navigation?.navigate('ActiveTripChatScreen'))}
          accessibilityRole="button"
        >
          <Text style={styles.helpButtonText}>Help</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Success Banner */}
        <View style={styles.successBanner}>
          <View style={styles.successIconCircle}>
            <Feather name="check" size={24} color="#ffffff" />
          </View>
          <Text style={styles.successTitle}>DROP COMPLETED</Text>
          <Text style={styles.successSubtitle}>Delivery successfully handed over.</Text>
        </View>

        {/* Stop Details Card */}
        <View style={styles.detailsCard}>
          {/* Destination */}
          <View style={styles.detailsRow}>
            <View style={styles.detailsTextContainer}>
              <Text style={styles.labelCaps}>DESTINATION</Text>
              <Text style={styles.valueText}>{currentDrop?.address}</Text>
              <Text style={styles.timeText}>10:45 AM, Oct 24</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Receiver */}
          <View style={styles.detailsRow}>
            <View style={styles.iconSquare}>
              <Feather name="user" size={20} color={colors.onSecondaryContainer} />
            </View>
            <View style={styles.detailsTextContainer}>
              <Text style={styles.labelCaps}>RECEIVER</Text>
              <Text style={styles.valueText}>{currentDrop?.contactName}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Delivery Proof */}
          <View style={styles.proofSection}>
            <Text style={styles.labelCaps}>DELIVERY PROOF</Text>
            <View style={styles.proofCard}>
              <Image
                source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDYHXtLNRxeITV8r4LMLNBHPsD3JBUASih7-9196z6kCBVEAvoQJBS4-TCzaKtDD0SOjPNAONo79X7rHWdB5Zm2ecEu44_2FcBXzrbM3UICr78N1QW3AISu5iNvwrQ70NNJMh1Z0nDs-iCgdiqlqnBNsrDipR-QS3MzdyIbZJ-YMEkrFIbEQdMlzH_3ROiOKkIBDXY0v0VQFcM1P6yEidAB05iSYylfJvburUZ-9E7EDANlIJBcgifS' }}
                style={styles.proofImage}
              />
              <View style={styles.proofTextContainer}>
                <Text style={styles.proofTitle}>Verified & Photo Uploaded</Text>
                <Text style={styles.proofSubtitle}>System timestamp: 10:46 AM</Text>
              </View>
              <Feather name="check-circle" size={24} color="#4caf50" />
            </View>
          </View>
        </View>

        {/* Next Stop Section */}
        {nextDrop && (
          <View style={styles.nextStopCard}>
            <Text style={styles.nextStopLabel}>NEXT STOP</Text>
            <Text style={styles.nextStopTitle}>Drop 2: {nextDrop.address}</Text>
            <Text style={styles.nextStopSubtitle}>Est. 12 mins away (4.2 km)</Text>

            <Pressable
              style={styles.trackButton}
              onPress={() => (onTrackNextStop ? onTrackNextStop() : navigation?.navigate('NextDropScreen'))}
              accessibilityRole="button"
            >
              <Text style={styles.trackButtonText}>Track Next Stop</Text>
              <Feather name="navigation" size={20} color={colors.onPrimary} />
            </Pressable>
          </View>
        )}

        {/* Always-available route to the trip summary */}
        <Pressable
          style={styles.summaryButton}
          onPress={() => navigation?.navigate('FinalDeliverySummaryScreen')}
          accessibilityRole="button"
        >
          <Text style={styles.summaryButtonText}>VIEW DELIVERY SUMMARY</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  helpButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  helpButtonText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.labelSm.fontFamily,
  },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.md,
    paddingBottom: 100, // accommodate bottom nav if present
    gap: spacing.lg,
  },

  // Success Banner
  successBanner: {
    backgroundColor: '#e8f5e9',
    borderRadius: 24,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#c8e6c9',
  },
  successIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#4caf50',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  successTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: '#2e7d32',
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: 4,
  },
  successSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: '#388e3c',
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Details Card
  detailsCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 24,
    padding: spacing.xl,
    ...shadows.card,
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconSquare: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsTextContainer: {
    flex: 1,
  },
  labelCaps: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelCaps.letterSpacing,
    marginBottom: 4,
  },
  valueText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  timeText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
    opacity: 0.3,
    marginVertical: spacing.lg,
  },
  proofSection: {
    marginTop: spacing.xs,
  },
  proofCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  proofImage: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surface,
  },
  proofTextContainer: {
    flex: 1,
  },
  proofTitle: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '500',
    color: colors.primary,
    fontFamily: typography.bodyMd.fontFamily,
  },
  proofSubtitle: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: 2,
  },

  // Next Stop Card
  nextStopCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 24,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.secondaryFixedDim,
    ...shadows.card,
  },
  nextStopLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelCaps.letterSpacing,
    marginBottom: spacing.xs,
  },
  nextStopTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  nextStopSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 4,
    marginBottom: spacing.lg,
  },
  trackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    height: 56,
    borderRadius: borderRadius.full,
  },
  trackButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },

  // Secondary (outline) CTA
  summaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  summaryButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default DropCompletedStateScreen;
