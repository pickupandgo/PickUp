import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import Button from '../../components/atoms/Button';

export interface CancellationConfirmationScreenProps {
  readonly eta?: string;
  readonly vehicleInfo?: string;
  readonly cancelFee?: string;
  readonly feeNote?: string;
  readonly policyText?: string;
  readonly onCancelTrip?: () => void;
  readonly onKeepTrip?: () => void;
  readonly onClose?: () => void;
}

const CancellationConfirmationScreen: React.FC<CancellationConfirmationScreenProps & { navigation?: any }> = ({
  eta = 'Driver is 5 mins away',
  vehicleInfo = 'Tata Ace • RJ 19 XX 1234',
  cancelFee = '₹112.50',
  feeNote = '(25% of fare)',
  policyText = "A cancellation fee may apply based on the driver's proximity to the pickup. Charges are determined by the current cancellation policy.",
  onCancelTrip,
  onKeepTrip,
  onClose,
  navigation,
}) => {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Background Dim (Simulating modal) */}
      <View style={styles.backdrop} />

      {/* Bottom Sheet Content */}
      <View style={styles.sheetContainer}>
        {/* Drag Handle Indicator */}
        <View style={styles.dragHandleContainer}>
          <View style={styles.dragHandle} />
        </View>

        <View style={styles.contentPadding}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Cancel Trip?</Text>
            <Pressable
              style={styles.closeButton}
              onPress={() => (onClose ? onClose() : navigation?.goBack())}
            >
              <Feather name="x" size={20} color={colors.onSurfaceVariant} />
            </Pressable>
          </View>

          {/* Trip Context */}
          <View style={styles.contextCard}>
            <View style={styles.vehicleIconBox}>
              <MaterialIcons name="local-shipping" size={24} color={colors.onSecondaryContainer} />
            </View>
            <View style={styles.contextTexts}>
              <Text style={styles.etaText}>{eta}</Text>
              <Text style={styles.vehicleText}>{vehicleInfo}</Text>
            </View>
          </View>

          {/* Warning Box */}
          <View style={styles.warningBox}>
            <View style={styles.warningHeader}>
              <MaterialIcons name="warning" size={20} color={colors.error} style={styles.warningIcon} />
              <View style={styles.warningTexts}>
                <Text style={styles.warningTitle}>Estimated Cancellation Fee: {cancelFee}</Text>
                <Text style={styles.warningSubtitle}>{feeNote}</Text>
              </View>
            </View>
            <View style={styles.policyBox}>
              <Text style={styles.policyText}>{policyText}</Text>
            </View>
          </View>

          {/* Actions */}
          <View style={styles.actionsContainer}>
            <Button
              label="CANCEL TRIP"
              onPress={() => {
                onCancelTrip?.();
                navigation?.navigate('CancellationResultScreen');
              }}
              variant="primary" // The design has it red, but we'll use a custom style or Button variant if we had one. Using button with custom color via style.
              fullWidth
              size="lg"
              style={styles.cancelButton}
            />
            <Button
              label="KEEP TRIP"
              onPress={() => (onKeepTrip ? onKeepTrip() : navigation?.goBack())}
              variant="secondary"
              fullWidth
              size="lg"
              style={styles.keepButton}
            />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface + 'B3', // Dimmed surface (approx 70%)
    // Wait, the design says bg-surface-dim. 
    // We'll use a solid color for the safe area and let the sheet sit at the bottom.
  },
  sheetContainer: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    ...shadows.card,
    elevation: 16,
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  dragHandle: {
    width: 48,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.outlineVariant,
    opacity: 0.5,
  },
  contentPadding: {
    padding: spacing.marginMobile,
    paddingBottom: spacing.xxxl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLow,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.lg,
  },
  vehicleIconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  contextTexts: {
    flex: 1,
  },
  etaText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginBottom: 2,
  },
  vehicleText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  warningBox: {
    backgroundColor: colors.errorContainer + '33', // 20% opacity
    borderColor: colors.errorContainer,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.xl,
  },
  warningHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  warningIcon: {
    marginTop: 2,
    marginRight: spacing.sm,
  },
  warningTexts: {
    flex: 1,
  },
  warningTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.error,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: 2,
  },
  warningSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  policyBox: {
    backgroundColor: colors.surfaceContainerLow,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    marginTop: spacing.xs,
  },
  policyText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  actionsContainer: {
    gap: spacing.md,
  },
  cancelButton: {
    backgroundColor: colors.error,
  },
  keepButton: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
});

export default CancellationConfirmationScreen;
