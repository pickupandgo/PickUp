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

export interface DigitalReceiptScreenProps {
  readonly tripId?: string;
  readonly date?: string;
  readonly vehicle?: string;
  readonly baseFare?: string;
  readonly insurance?: string;
  readonly surcharges?: string;
  readonly totalAmount?: string;
  readonly paymentMethod?: string;
  readonly paymentStatus?: string;
  readonly onShareReceipt?: () => void;
  readonly onHome?: () => void;
  readonly onHelp?: () => void;
  readonly onBack?: () => void;
}

const DigitalReceiptScreen: React.FC<DigitalReceiptScreenProps & { navigation?: any }> = ({
  tripId = '#TRP-8472-X',
  date = 'Oct 24, 2023 • 11:30 AM',
  vehicle = 'Tata Ace (RJ 19 XX 1234)',
  baseFare = '₹380.00',
  insurance = '₹25.00',
  surcharges = '₹45.00',
  totalAmount = '₹450.00',
  paymentMethod = 'UPI (Secure Gateway)',
  paymentStatus = 'Paid',
  onShareReceipt,
  onHome,
  onHelp,
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
          <Feather name="arrow-left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Precision Mobility</Text>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onHelp ? onHelp() : navigation?.navigate('ActiveTripChatScreen'))}
        >
          <Feather name="help-circle" size={24} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header Section */}
        <View style={styles.headerSection}>
          <View style={styles.successIconBox}>
            <MaterialIcons name="check-circle" size={32} color={colors.onSecondaryContainer} />
          </View>
          <Text style={styles.statusTitle}>Payment Successful</Text>
          <Text style={styles.statusSubtitle}>Trip Receipt</Text>
        </View>

        {/* Receipt Card */}
        <View style={styles.receiptCard}>
          {/* Decorative receipt edges could be SVGs, but we'll stick to RN borders/shadows */}
          
          {/* Trip Details */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>TRIP DETAILS</Text>
            <View style={styles.row}>
              <Text style={styles.detailLabel}>Trip ID</Text>
              <Text style={styles.monoValue}>{tripId}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.detailLabel}>Date & Time</Text>
              <Text style={styles.detailValue}>{date}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.detailLabel}>Vehicle</Text>
              <Text style={styles.detailValue}>{vehicle}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Route Summary */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>ROUTE SUMMARY</Text>
            
            <View style={styles.routeContainer}>
              <View style={styles.timelineLine} />
              
              {/* Pickup */}
              <View style={styles.routeItem}>
                <View style={styles.pickupDotOuter}>
                  <View style={styles.pickupDotInner} />
                </View>
                <View style={styles.routeTextContainer}>
                  <Text style={styles.routeLabel}>Pickup</Text>
                  <Text style={styles.routeValue}>Sardarpura Warehouse</Text>
                </View>
              </View>
              
              {/* Drop 1 */}
              <View style={styles.routeItem}>
                <View style={styles.dropIntermediateDot} />
                <View style={styles.routeTextContainer}>
                  <Text style={styles.routeLabel}>Drop 1</Text>
                  <Text style={styles.routeValue}>Ratanada Hub</Text>
                </View>
              </View>

              {/* Drop 2 */}
              <View style={styles.routeItem}>
                <View style={styles.dropIntermediateDot} />
                <View style={styles.routeTextContainer}>
                  <Text style={styles.routeLabel}>Drop 2</Text>
                  <Text style={styles.routeValue}>Pal Road Business Center</Text>
                </View>
              </View>

              {/* Drop 3 */}
              <View style={styles.routeItem}>
                <View style={styles.dropFinalDot} />
                <View style={styles.routeTextContainer}>
                  <Text style={styles.routeLabel}>Drop 3</Text>
                  <Text style={styles.routeValue}>Basni Phase II</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Fare Summary */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>FARE SUMMARY</Text>
            <View style={styles.row}>
              <Text style={styles.detailLabel}>Base Fare</Text>
              <Text style={styles.monoValue}>{baseFare}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.detailLabel}>Insurance (Goods)</Text>
              <Text style={styles.monoValue}>{insurance}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.detailLabel}>Surcharges (Waiting/Multi-drop)</Text>
              <Text style={styles.monoValue}>{surcharges}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total Amount</Text>
              <Text style={styles.totalValue}>{totalAmount}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Payment Details */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>PAYMENT DETAILS</Text>
            <View style={styles.paymentMethodCard}>
              <View style={styles.paymentMethodLeft}>
                <MaterialIcons name="account-balance" size={24} color={colors.onSurfaceVariant} />
                <View style={styles.paymentMethodTexts}>
                  <Text style={styles.paymentMethodName}>{paymentMethod}</Text>
                  <Text style={styles.paymentMethodStatus}>Status: {paymentStatus}</Text>
                </View>
              </View>
              <Feather name="check" size={20} color={colors.secondary} />
            </View>
          </View>

        </View>

        {/* Actions */}
        <View style={styles.actionsContainer}>
          <Button
            label="SHARE RECEIPT"
            onPress={() =>
              onShareReceipt
                ? onShareReceipt()
                : navigation?.navigate('ShareTrackingSheetScreen')
            }
            variant="primary"
            fullWidth
            size="lg"
            icon={<Feather name="share" size={20} color={colors.onPrimary} />}
          />
          <Button
            label="BACK TO HOME"
            onPress={() => (onHome ? onHome() : navigation?.navigate('HomeScreen'))}
            variant="secondary"
            fullWidth
            size="lg"
          />
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
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  scrollContent: {
    padding: spacing.marginMobile,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  successIconBox: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  statusTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: 4,
  },
  statusSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  receiptCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    marginBottom: spacing.xxl,
    ...shadows.card,
  },
  section: {
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  detailLabel: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  detailValue: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  monoValue: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: typography.dataMono.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
    letterSpacing: typography.dataMono.letterSpacing,
  },
  divider: {
    height: 1,
    backgroundColor: colors.outlineVariant + '4D', // 30% opacity
    marginVertical: spacing.lg,
  },
  routeContainer: {
    paddingLeft: 24,
    position: 'relative',
  },
  timelineLine: {
    position: 'absolute',
    left: 4.5, // Center line with dots
    top: 10,
    bottom: 24,
    width: 2,
    backgroundColor: colors.outlineVariant + '80', // 50% opacity
  },
  routeItem: {
    position: 'relative',
    marginBottom: spacing.lg,
  },
  pickupDotOuter: {
    position: 'absolute',
    left: -26.5,
    top: 4,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surfaceContainerLow,
    zIndex: 10,
  },
  pickupDotInner: {
    // Empty inner
  },
  dropIntermediateDot: {
    position: 'absolute',
    left: -22.5,
    top: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.outline,
    zIndex: 10,
  },
  dropFinalDot: {
    position: 'absolute',
    left: -24.5,
    top: 6,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
    zIndex: 10,
  },
  routeTextContainer: {
    paddingLeft: spacing.sm,
  },
  routeLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginBottom: 2,
  },
  routeValue: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.md,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderTopColor: colors.outlineVariant,
  },
  totalLabel: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
    fontFamily: typography.dataMono.fontFamily,
    letterSpacing: typography.dataMono.letterSpacing,
  },
  paymentMethodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.md,
  },
  paymentMethodLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  paymentMethodTexts: {
    flexDirection: 'column',
  },
  paymentMethodName: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  paymentMethodStatus: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: 2,
  },
  actionsContainer: {
    gap: spacing.md,
  },
});

export default DigitalReceiptScreen;
