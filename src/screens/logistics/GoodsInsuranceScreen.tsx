import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';

export interface GoodsInsuranceScreenProps {
  readonly onBack?: () => void;
  readonly onContinue?: () => void;
  readonly onHelp?: () => void;
}

const GoodsInsuranceScreen: React.FC<GoodsInsuranceScreenProps & { navigation?: any }> = ({
  onBack,
  onContinue,
  onHelp,
  navigation,
}) => {
  const [declaredValue, setDeclaredValue] = useState('50,000');
  const [isInsured, setIsInsured] = useState(false);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={22} color={colors.onSurfaceVariant} />
        </Pressable>
        <Text style={styles.headerTitle}>Goods Insurance</Text>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onHelp ? onHelp() : navigation?.navigate('ActiveTripChatScreen'))}
          accessibilityRole="button"
          accessibilityLabel="Help"
        >
          <Feather name="help-circle" size={22} color={colors.onSurfaceVariant} />
        </Pressable>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header Section */}
        <View style={styles.titleSection}>
          <Text style={styles.pageTitle}>Protect Your Delivery</Text>
          <Text style={styles.pageSubtitle}>Optional protection for eligible goods during transit.</Text>
        </View>

        {/* Value Declaration */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Feather name="package" size={20} color={colors.primary} />
            <Text style={styles.cardTitle}>Declared Value</Text>
          </View>
          <Text style={styles.cardDesc}>
            Enter the estimated value of the items you are shipping to get an insurance quote.
          </Text>
          <View style={styles.valueInputWrapper}>
            <Text style={styles.currencyPrefix}>₹</Text>
            <TextInput
              style={styles.valueInput}
              placeholder="0"
              placeholderTextColor={colors.outline}
              keyboardType="numeric"
              value={declaredValue}
              onChangeText={setDeclaredValue}
              accessibilityLabel="Declared value"
            />
          </View>
        </View>

        {/* Insurance Option Toggle */}
        <Pressable
          style={[styles.insuranceCard, isInsured && styles.insuranceCardActive]}
          onPress={() => setIsInsured(!isInsured)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isInsured }}
          accessibilityLabel="Select Goods Insurance"
        >
          <View style={styles.insuranceHeader}>
            <View style={styles.insuranceHeaderLeft}>
              <View style={styles.iconCircle}>
                <Feather name="shield" size={20} color={colors.onSecondaryContainer} />
              </View>
              <View style={styles.insuranceTitleCol}>
                <Text style={styles.insuranceTitle}>Goods Insurance</Text>
                <Text style={styles.insurancePremium}>Est. Premium: ₹ 250</Text>
              </View>
            </View>
            <View style={[styles.checkbox, isInsured && styles.checkboxChecked]}>
              {isInsured && <Feather name="check" size={14} color={colors.onPrimary} />}
            </View>
          </View>

          <View style={styles.coverageBox}>
            <Text style={styles.coverageLabel}>COVERAGE SUMMARY</Text>
            <View style={styles.bulletList}>
              <View style={styles.bulletItem}>
                <View style={styles.bulletDot} />
                <Text style={styles.bulletText}>Protection against loss or severe damage</Text>
              </View>
              <View style={styles.bulletItem}>
                <View style={styles.bulletDot} />
                <Text style={styles.bulletText}>Coverage up to declared value</Text>
              </View>
              <View style={styles.bulletItem}>
                <View style={styles.bulletDot} />
                <Text style={styles.bulletText}>Subject to standard terms and conditions</Text>
              </View>
            </View>
          </View>
        </Pressable>
      </ScrollView>

      {/* Bottom Action Bar */}
      <View style={styles.bottomBar}>
        <Pressable
          style={styles.continueButton}
          onPress={() => {
            onContinue?.();
            navigation?.navigate('ReceiverDetailsScreen');
          }}
          accessibilityRole="button"
          accessibilityLabel="Continue"
        >
          <Text style={styles.continueText}>CONTINUE</Text>
        </Pressable>
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
    paddingHorizontal: spacing.marginMobile,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface,
  },
  iconButton: {
    width: 48,
    height: 48,
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
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.xl,
    paddingBottom: 140,
    gap: spacing.xl,
  },

  // Title Section
  titleSection: {
    gap: spacing.xs,
  },
  pageTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  pageSubtitle: {
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyLg.fontFamily,
  },

  // Card general
  card: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg, // approx 8px to 12px based on HTML
    padding: spacing.xl,
    ...shadows.ghostShadow,
    gap: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  cardDesc: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Input
  valueInputWrapper: {
    position: 'relative',
    marginTop: spacing.sm,
  },
  currencyPrefix: {
    position: 'absolute',
    left: spacing.marginMobile,
    top: 14,
    fontSize: typography.headlineSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.headlineSm.fontFamily,
    zIndex: 1,
  },
  valueInput: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingLeft: 40,
    paddingRight: spacing.marginMobile,
    fontSize: typography.dataMono.fontSize,
    color: colors.onBackground,
    fontFamily: typography.dataMono.fontFamily,
  },

  // Insurance Card
  insuranceCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 24,
    padding: spacing.xl,
    borderWidth: 2,
    borderColor: 'transparent',
    ...shadows.ghostShadow,
  },
  insuranceCardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceBright,
  },
  insuranceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  insuranceHeaderLeft: {
    flexDirection: 'row',
    gap: spacing.marginMobile,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insuranceTitleCol: {
    gap: 4,
    justifyContent: 'center',
  },
  insuranceTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  insurancePremium: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: typography.dataMono.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.dataMono.fontFamily,
  },

  // Checkbox
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  // Coverage Box
  coverageBox: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
    padding: spacing.marginMobile,
    gap: spacing.sm,
  },
  coverageLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  bulletList: {
    gap: 4,
  },
  bulletItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  bulletDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.onBackground,
    marginTop: 8,
  },
  bulletText: {
    flex: 1,
    fontSize: typography.bodyMd.fontSize,
    color: colors.onBackground,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Bottom Bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.marginMobile,
    paddingBottom: spacing.xxl,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant,
    ...shadows.ghostShadow,
  },
  continueButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.marginMobile,
  },
  continueText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default GoodsInsuranceScreen;
