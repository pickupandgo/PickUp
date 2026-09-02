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

export interface PaymentFailedScreenProps {
  readonly amountDue?: string;
  readonly onRetry?: () => void;
  readonly onChangeMethod?: () => void;
  readonly onBack?: () => void;
}

const PaymentFailedScreen: React.FC<PaymentFailedScreenProps & { navigation?: any }> = ({
  amountDue = '₹ 340',
  onRetry,
  onChangeMethod,
  onBack,
  navigation,
}) => {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
        >
          <Feather name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Pick Up</Text>
        <View style={styles.iconButton} />
      </View>

      <View style={styles.mainContent}>
        <View style={styles.statusCard}>
          {/* Error Icon */}
          <View style={styles.errorIconBox}>
            <MaterialIcons name="error" size={48} color={colors.error} />
          </View>
          
          {/* Status Headers */}
          <Text style={styles.statusTitle}>Payment Failed</Text>
          <Text style={styles.statusSubtitle}>
            We couldn't process your payment. Please check your connection or try a different payment method.
          </Text>

          {/* Amount Detail */}
          <View style={styles.amountContainer}>
            <Text style={styles.amountLabel}>Amount Due</Text>
            <Text style={styles.amountValue}>{amountDue}</Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsContainer}>
          <Button
            label="Retry Payment"
            onPress={() =>
              onRetry ? onRetry() : navigation?.navigate('PaymentMethodSelectedScreen')
            }
            variant="primary"
            fullWidth
            size="lg"
          />
          <Button
            label="Change Payment Method"
            onPress={() =>
              onChangeMethod ? onChangeMethod() : navigation?.navigate('PaymentSelectionScreen')
            }
            variant="secondary"
            fullWidth
            size="lg"
          />
        </View>
      </View>
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
    backgroundColor: colors.surface,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
  },
  mainContent: {
    flex: 1,
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.xl,
    justifyContent: 'center',
  },
  statusCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.xl, // Custom extra rounded corner matching design
    padding: spacing.xxl,
    alignItems: 'center',
    marginBottom: spacing.xxxl,
    ...shadows.card,
  },
  errorIconBox: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.errorContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  statusTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  statusSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    textAlign: 'center',
    marginBottom: spacing.xl,
    maxWidth: 280,
  },
  amountContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  amountLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  amountValue: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
    letterSpacing: typography.dataMono.letterSpacing,
  },
  actionsContainer: {
    gap: spacing.md,
    marginTop: 'auto',
  },
});

export default PaymentFailedScreen;
