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
import { useBooking } from '../../state/BookingContext';

export interface GoodsDetailsScreenProps {
  readonly onBack?: () => void;
  readonly onContinue?: () => void;
}

const goodsTypes = ['Furniture', 'Electronics', 'Clothing/Apparel', 'Documents', 'Other'];

const GoodsDetailsScreen: React.FC<GoodsDetailsScreenProps & { navigation?: any }> = ({
  onBack,
  onContinue,
  navigation,
}) => {
  const { setGoods } = useBooking();
  const [selectedType, setSelectedType] = useState<string>('');
  const [description, setDescription] = useState('');
  const [weight, setWeight] = useState('');
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lbs'>('kg');
  const [declaredValue, setDeclaredValue] = useState('');
  const [instructions, setInstructions] = useState('');

  // Local-only selector: cycles through the available goods types on each tap.
  const handleCycleGoodsType = () => {
    const nextIndex = (goodsTypes.indexOf(selectedType) + 1) % goodsTypes.length;
    setSelectedType(goodsTypes[nextIndex]);
  };

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
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Goods Details</Text>
        <Pressable
          style={styles.iconButton}
          onPress={() => navigation?.navigate('ActiveTripChatScreen')}
          accessibilityRole="button"
          accessibilityLabel="More options"
        >
          <Feather name="more-vertical" size={22} color={colors.primary} />
        </Pressable>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Goods Type */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Goods/Load Type</Text>
          <View style={styles.selectContainer}>
            <Pressable
              style={styles.selectButton}
              onPress={handleCycleGoodsType}
              accessibilityRole="button"
              accessibilityLabel="Select goods type"
            >
              <Text style={[styles.selectText, !selectedType && styles.selectPlaceholder]}>
                {selectedType || 'Select goods type...'}
              </Text>
              <Feather name="chevron-down" size={20} color={colors.onSurfaceVariant} />
            </Pressable>
          </View>
        </View>

        {/* Goods Description */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Goods Description</Text>
          <TextInput
            style={[styles.textInput, styles.textArea]}
            placeholder="e.g., '3 boxes of kitchenware, fragile items included.'"
            placeholderTextColor={colors.outline}
            multiline
            numberOfLines={3}
            value={description}
            onChangeText={setDescription}
            textAlignVertical="top"
            accessibilityLabel="Goods description"
          />
        </View>

        {/* Weight */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, styles.fieldLabelError]}>Approximate Weight *</Text>
          <View style={styles.weightRow}>
            <TextInput
              style={[styles.textInput, styles.weightInput, styles.inputError]}
              placeholder="Enter weight"
              placeholderTextColor={colors.outline}
              keyboardType="numeric"
              value={weight}
              onChangeText={setWeight}
              accessibilityLabel="Approximate weight"
            />
            <View style={styles.unitToggle}>
              <Pressable
                style={[styles.unitButton, weightUnit === 'kg' && styles.unitButtonActive]}
                onPress={() => setWeightUnit('kg')}
              >
                <Text style={[styles.unitText, weightUnit === 'kg' && styles.unitTextActive]}>kg</Text>
              </Pressable>
              <Pressable
                style={[styles.unitButton, weightUnit === 'lbs' && styles.unitButtonActive]}
                onPress={() => setWeightUnit('lbs')}
              >
                <Text style={[styles.unitText, weightUnit === 'lbs' && styles.unitTextActive]}>lbs</Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.errorHint}>Weight is required for accurate pricing.</Text>
        </View>

        {/* Declared Value */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Declared Goods Value</Text>
          <View style={styles.valueInputWrapper}>
            <Text style={styles.currencyPrefix}>₹</Text>
            <TextInput
              style={[styles.textInput, styles.valueInput]}
              placeholder="0.00"
              placeholderTextColor={colors.outline}
              keyboardType="numeric"
              value={declaredValue}
              onChangeText={setDeclaredValue}
              accessibilityLabel="Declared goods value"
            />
          </View>
        </View>

        {/* Special Instructions */}
        <View style={styles.fieldGroup}>
          <View style={styles.labelRow}>
            <Text style={styles.fieldLabel}>Special Instructions</Text>
            <Text style={styles.optionalTag}>(Optional)</Text>
          </View>
          <TextInput
            style={[styles.textInput, styles.textAreaSmall]}
            placeholder="Any specific handling instructions..."
            placeholderTextColor={colors.outline}
            multiline
            numberOfLines={2}
            value={instructions}
            onChangeText={setInstructions}
            textAlignVertical="top"
            accessibilityLabel="Special instructions"
          />
        </View>
      </ScrollView>

      {/* Bottom Action Bar */}
      <View style={styles.bottomBar}>
        <Pressable
          style={styles.continueButton}
          onPress={() => {
            // Weight drives the engine's fare multiplier, so persist it.
            // The engine expects kilograms.
            const parsed = Number.parseFloat(weight);
            const weightKg = Number.isFinite(parsed)
              ? weightUnit === 'lbs'
                ? parsed * 0.453_592
                : parsed
              : undefined;

            setGoods({
              weightKg,
              goodsDescription: description || selectedType || undefined,
              declaredValue: declaredValue || undefined,
            });
            onContinue?.();
            navigation?.navigate('GoodsInsuranceScreen');
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
    backgroundColor: colors.background,
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: '700',
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.xl,
    paddingBottom: 140,
    gap: spacing.xl,
  },

  // Fields
  fieldGroup: { gap: spacing.sm },
  fieldLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  fieldLabelError: { color: colors.error },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  optionalTag: {
    fontSize: 10,
    color: colors.outline,
    fontFamily: typography.labelSm.fontFamily,
  },

  // Select
  selectContainer: {},
  selectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceVariant,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: 12,
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.md,
  },
  selectText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  selectPlaceholder: {
    color: colors.outline,
  },

  // Text Inputs
  textInput: {
    backgroundColor: colors.surfaceVariant,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: 12,
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.md,
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  textArea: {
    minHeight: 80,
  },
  textAreaSmall: {
    minHeight: 60,
  },
  inputError: {
    backgroundColor: colors.errorContainer,
    borderColor: colors.error,
  },

  // Weight
  weightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  weightInput: {
    flex: 1,
  },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: 12,
    padding: 4,
  },
  unitButton: {
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.sm,
    borderRadius: 8,
  },
  unitButtonActive: {
    backgroundColor: colors.surface,
    ...shadows.ghostShadow,
  },
  unitText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  unitTextActive: {
    color: colors.onSurface,
  },
  errorHint: {
    fontSize: typography.labelSm.fontSize,
    color: colors.error,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: 2,
  },

  // Value Input
  valueInputWrapper: {
    position: 'relative',
  },
  currencyPrefix: {
    position: 'absolute',
    left: spacing.marginMobile,
    top: 14,
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    zIndex: 1,
  },
  valueInput: {
    paddingLeft: 36,
  },

  // Bottom Bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.marginMobile,
    paddingBottom: spacing.xxl,
    ...shadows.elevated,
  },
  continueButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.marginMobile,
    ...shadows.ghostShadow,
  },
  continueText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default GoodsDetailsScreen;
