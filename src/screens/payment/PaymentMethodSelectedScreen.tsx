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
import Button from '../../components/atoms/Button';

export interface PaymentMethodSelectedScreenProps {
  readonly tripTitle?: string;
  readonly tripDate?: string;
  readonly baseFare?: string;
  readonly taxes?: string;
  readonly total?: string;
  readonly methodName?: string;
  readonly methodDetail?: string;
  readonly onChangeMethod?: () => void;
  readonly onPay?: () => void;
  readonly onBack?: () => void;
}

const PaymentMethodSelectedScreen: React.FC<PaymentMethodSelectedScreenProps & { navigation?: any }> = ({
  tripTitle = 'Ride to Downtown',
  tripDate = 'Today, 2:30 PM',
  baseFare = '₹ 300',
  taxes = '₹ 40',
  total = '₹ 340',
  methodName = 'UPI Payment',
  methodDetail = 'user@upi',
  onChangeMethod,
  onPay,
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
        <Text style={styles.headerTitle}>Payment</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Booking Summary Bento Card */}
        <View style={styles.summaryCard}>
          <View style={styles.tripHeader}>
            <View style={styles.tripIconBox}>
              <MaterialIcons name="directions-car" size={24} color={colors.primary} />
            </View>
            <View style={styles.tripHeaderText}>
              <Text style={styles.tripTitle}>{tripTitle}</Text>
              <Text style={styles.tripDate}>{tripDate}</Text>
            </View>
          </View>

          <View style={styles.fareDetails}>
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>Base Fare</Text>
              <Text style={styles.monoValue}>{baseFare}</Text>
            </View>
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>Taxes & Fees</Text>
              <Text style={styles.monoValue}>{taxes}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>{total}</Text>
            </View>
          </View>
        </View>

        {/* Selected Payment Method Card */}
        <View style={styles.methodSection}>
          <Text style={styles.sectionLabel}>SELECTED METHOD</Text>
          
          <View style={styles.methodCard}>
            <View style={styles.methodLeft}>
              <View style={styles.methodIconBox}>
                <MaterialIcons name="account-balance" size={20} color={colors.primary} />
              </View>
              <View style={styles.methodTextContainer}>
                <Text style={styles.methodName}>{methodName}</Text>
                <Text style={styles.methodDetail}>{methodDetail}</Text>
              </View>
            </View>
            
            <Pressable
              style={styles.changeBtn}
              onPress={() => (onChangeMethod ? onChangeMethod() : navigation?.goBack())}
            >
              <Text style={styles.changeBtnText}>Change</Text>
            </Pressable>
          </View>
        </View>

        {/* Security Badge */}
        <View style={styles.securityBadge}>
          <MaterialIcons name="verified-user" size={18} color={colors.onSurfaceVariant} />
          <Text style={styles.securityText}>Payments are secure and encrypted</Text>
        </View>
      </ScrollView>

      {/* Bottom Action Area */}
      <View style={styles.bottomActions}>
        <Button
          label={`Pay ${total}`}
          onPress={() => {
            onPay?.();
            navigation?.navigate('PaymentProcessingScreen');
          }}
          variant="primary"
          fullWidth
          size="lg"
        />
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
    zIndex: 50,
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
  scrollContent: {
    padding: spacing.marginMobile,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl * 2,
    flexGrow: 1,
  },
  summaryCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    marginBottom: spacing.xl,
    ...shadows.card,
  },
  tripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHighest + '80', // 50% opacity
    marginBottom: spacing.lg,
  },
  tripIconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripHeaderText: {
    flex: 1,
  },
  tripTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  tripDate: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 2,
  },
  fareDetails: {
    gap: spacing.md,
  },
  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fareLabel: {
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyLg.fontFamily,
  },
  monoValue: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: typography.dataMono.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
    letterSpacing: typography.dataMono.letterSpacing,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.md,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderTopColor: colors.surfaceContainerHighest,
  },
  totalLabel: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: 'bold',
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  totalValue: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: 'bold',
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  methodSection: {
    marginBottom: 'auto',
  },
  sectionLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.outline,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.secondaryContainer + '4D', // 30% opacity
    borderWidth: 1,
    borderColor: colors.secondaryFixedDim + '80', // 50% opacity
    borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
  methodLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  methodIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  methodTextContainer: {
    flexDirection: 'column',
  },
  methodName: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  methodDetail: {
    fontSize: typography.dataMono.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.dataMono.fontFamily,
    marginTop: 2,
  },
  changeBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  changeBtnText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '500',
    color: colors.secondary,
    fontFamily: typography.labelSm.fontFamily,
  },
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.xxxl,
  },
  securityText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  bottomActions: {
    backgroundColor: colors.surfaceContainerLow,
    padding: spacing.marginMobile,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainerHighest,
  },
});

export default PaymentMethodSelectedScreen;
