import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import { useBooking } from '../../state/BookingContext';
import { KeyboardAwareScrollView, useKeyboardAware } from '../../components/organisms';
import { GoodsTypeDropdown, GOODS_CATEGORIES } from '../../components/molecules';

export interface GoodsDetailsScreenProps {
  readonly onBack?: () => void;
  readonly onContinue?: () => void;
}

export { GOODS_CATEGORIES };

export const isValidWeight = (val: string): boolean => {
  const trimmed = val.trim();
  if (!trimmed) return false;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return false;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) && parsed > 0;
};

export const isValidDeclaredValue = (val: string): boolean => {
  const trimmed = val.trim().replace(/,/g, '');
  if (!trimmed) return false;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return false;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) && parsed > 0;
};

export const isValidDescription = (val: string): boolean => {
  return val.trim().length > 0;
};

export const isValidGoodsType = (val: string, allowedTypes: readonly string[] = GOODS_CATEGORIES): boolean => {
  return Boolean(val && allowedTypes.includes(val.trim()));
};

interface FormErrors {
  type?: string;
  description?: string;
  weight?: string;
  declaredValue?: string;
}

const GoodsDetailsScreen: React.FC<GoodsDetailsScreenProps & { navigation?: any }> = ({
  onBack,
  onContinue,
  navigation,
}) => {
  const { draft, setGoods } = useBooking();
  const keyboardAwareRef = useRef<any>(null);
  const scrollToInput = useCallback((target: any) => {
    keyboardAwareRef.current?.scrollIntoView(target);
  }, []);
  const [selectedType, setSelectedType] = useState<string>(() => draft.goodsType ?? '');

  const [description, setDescription] = useState<string>(() => draft.goodsDescription ?? '');
  const [weight, setWeight] = useState<string>(() => (draft.weightKg !== undefined ? String(draft.weightKg) : ''));
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lbs'>(() => draft.weightUnit ?? 'kg');
  const [declaredValue, setDeclaredValue] = useState<string>(() => {
    const raw = draft.declaredValue?.trim();
    if (!raw || raw === '0' || raw === '0.00' || raw === '2') return '';
    return raw;
  });
  const [instructions, setInstructions] = useState<string>(() => draft.specialInstructions ?? draft.pickupInstructions ?? '');

  const [fieldErrors, setFieldErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Field validation checks
  const isTypeValid = isValidGoodsType(selectedType);
  const isDescriptionValid = isValidDescription(description);
  const isWeightValid = isValidWeight(weight);
  const isDeclaredValueValid = isValidDeclaredValue(declaredValue);

  const isFormValid = isTypeValid && isDescriptionValid && isWeightValid && isDeclaredValueValid;
  const canContinue = isFormValid && !isSubmitting;

  const handleSelectType = (item: string) => {
    setSelectedType(item);
    setFieldErrors((prev) => ({ ...prev, type: undefined }));
  };

  const handleDescriptionChange = (text: string) => {
    setDescription(text);
    if (isValidDescription(text)) {
      setFieldErrors((prev) => ({ ...prev, description: undefined }));
    }
  };

  const handleWeightChange = (text: string) => {
    setWeight(text);
    if (isValidWeight(text)) {
      setFieldErrors((prev) => ({ ...prev, weight: undefined }));
    } else if (fieldErrors.weight) {
      // Keep real-time feedback active if the user previously had an error
      const trimmed = text.trim();
      if (!trimmed) {
        setFieldErrors((prev) => ({ ...prev, weight: 'Weight is required for accurate pricing.' }));
      } else if (!/^\d+(\.\d+)?$/.test(trimmed)) {
        setFieldErrors((prev) => ({ ...prev, weight: 'Please enter a valid numeric weight.' }));
      } else {
        setFieldErrors((prev) => ({ ...prev, weight: 'Weight must be greater than zero.' }));
      }
    }
  };

  const handleDeclaredValueChange = (text: string) => {
    setDeclaredValue(text);
    if (isValidDeclaredValue(text)) {
      setFieldErrors((prev) => ({ ...prev, declaredValue: undefined }));
    } else if (fieldErrors.declaredValue) {
      const trimmed = text.trim().replace(/,/g, '');
      if (!trimmed) {
        setFieldErrors((prev) => ({ ...prev, declaredValue: 'Declared goods value is required.' }));
      } else if (!/^\d+(\.\d+)?$/.test(trimmed)) {
        setFieldErrors((prev) => ({ ...prev, declaredValue: 'Please enter a valid numeric value.' }));
      } else {
        setFieldErrors((prev) => ({ ...prev, declaredValue: 'Declared value must be greater than zero.' }));
      }
    }
  };

  const handleContinue = () => {
    if (isSubmitting) return;

    // Validate all required fields
    const errors: FormErrors = {};

    if (!isValidGoodsType(selectedType)) {
      errors.type = 'Please select a goods/load type.';
    }
    if (!isValidDescription(description)) {
      errors.description = 'Goods description is required.';
    }
    if (!isValidWeight(weight)) {
      const trimmed = weight.trim();
      if (!trimmed) {
        errors.weight = 'Weight is required for accurate pricing.';
      } else if (!/^\d+(\.\d+)?$/.test(trimmed)) {
        errors.weight = 'Please enter a valid numeric weight.';
      } else {
        errors.weight = 'Weight must be greater than zero.';
      }
    }
    if (!isValidDeclaredValue(declaredValue)) {
      const trimmed = declaredValue.trim().replace(/,/g, '');
      if (!trimmed) {
        errors.declaredValue = 'Declared goods value is required.';
      } else if (!/^\d+(\.\d+)?$/.test(trimmed)) {
        errors.declaredValue = 'Please enter a valid numeric value.';
      } else {
        errors.declaredValue = 'Declared value must be greater than zero.';
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      const parsedWeight = Number.parseFloat(weight.trim());
      const weightKg =
        weightUnit === 'lbs'
          ? Number((parsedWeight * 0.45359237).toFixed(3))
          : Number(parsedWeight.toFixed(3));

      const cleanDescription = description.trim();
      const cleanValue = declaredValue.trim().replace(/,/g, '');
      const cleanInstructions = instructions.trim();

      setGoods({
        weightKg,
        goodsDescription: cleanDescription,
        declaredValue: cleanValue,
        goodsType: selectedType,
        weightUnit,
        specialInstructions: cleanInstructions || undefined,
      });

      onContinue?.();
      navigation?.navigate('GoodsInsuranceScreen');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
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
      <KeyboardAwareScrollView
        ref={keyboardAwareRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        footer={
          <View style={styles.bottomBar}>
            <Pressable
              testID="goods-details-continue-button"
              style={[
                styles.continueButton,
                !canContinue && styles.continueButtonDisabled,
              ]}
              disabled={!canContinue}
              onPress={handleContinue}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canContinue }}
              accessibilityLabel="Continue"
            >
              <Text style={styles.continueText}>CONTINUE</Text>
            </Pressable>
          </View>
        }
      >
        {/* Goods Type */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, Boolean(fieldErrors.type) && styles.fieldLabelError]}>
            Goods/Load Type *
          </Text>
          <GoodsTypeDropdown
            selectedType={selectedType}
            onSelectType={handleSelectType}
            error={fieldErrors.type}
            categories={GOODS_CATEGORIES}
            placeholder="Select goods type..."
          />
          {Boolean(fieldErrors.type) && (
            <Text style={styles.errorHint} testID="error-goods-type">
              {fieldErrors.type}
            </Text>
          )}
        </View>

        {/* Goods Description */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, Boolean(fieldErrors.description) && styles.fieldLabelError]}>
            Goods Description *
          </Text>
          <TextInput
            testID="input-goods-description"
            style={[
              styles.textInput,
              styles.textArea,
              Boolean(fieldErrors.description) && styles.inputError,
            ]}
            placeholder="e.g., '3 boxes of kitchenware, fragile items included.'"
            placeholderTextColor={colors.outline}
            multiline
            numberOfLines={3}
            value={description}
            onChangeText={handleDescriptionChange}
            onFocus={(e) => scrollToInput(e?.target ?? e?.nativeEvent?.target)}
            textAlignVertical="top"
            accessibilityLabel="Goods description"
          />
          {Boolean(fieldErrors.description) && (
            <Text style={styles.errorHint} testID="error-goods-description">
              {fieldErrors.description}
            </Text>
          )}
        </View>

        {/* Weight */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, Boolean(fieldErrors.weight) && styles.fieldLabelError]}>
            Approximate Weight *
          </Text>
          <View style={styles.weightRow}>
            <TextInput
              testID="input-approximate-weight"
              style={[
                styles.textInput,
                styles.weightInput,
                Boolean(fieldErrors.weight) && styles.inputError,
              ]}
              placeholder="Enter weight"
              placeholderTextColor={colors.outline}
              keyboardType="numeric"
              value={weight}
              onChangeText={handleWeightChange}
              onFocus={(e) => scrollToInput(e?.target ?? e?.nativeEvent?.target)}
              accessibilityLabel="Approximate weight"
            />
            <View style={styles.unitToggle}>
              <Pressable
                testID="unit-toggle-kg"
                style={[styles.unitButton, weightUnit === 'kg' && styles.unitButtonActive]}
                onPress={() => setWeightUnit('kg')}
                accessibilityRole="button"
                accessibilityLabel="Unit in kilograms"
                accessibilityState={{ selected: weightUnit === 'kg' }}
              >
                <Text style={[styles.unitText, weightUnit === 'kg' && styles.unitTextActive]}>kg</Text>
              </Pressable>
              <Pressable
                testID="unit-toggle-lbs"
                style={[styles.unitButton, weightUnit === 'lbs' && styles.unitButtonActive]}
                onPress={() => setWeightUnit('lbs')}
                accessibilityRole="button"
                accessibilityLabel="Unit in pounds"
                accessibilityState={{ selected: weightUnit === 'lbs' }}
              >
                <Text style={[styles.unitText, weightUnit === 'lbs' && styles.unitTextActive]}>lbs</Text>
              </Pressable>
            </View>
          </View>
          {Boolean(fieldErrors.weight) && (
            <Text style={styles.errorHint} testID="error-weight">
              {fieldErrors.weight}
            </Text>
          )}
        </View>

        {/* Declared Value */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, Boolean(fieldErrors.declaredValue) && styles.fieldLabelError]}>
            Declared Goods Value *
          </Text>
          <View style={styles.valueInputWrapper}>
            <Text testID="currency-prefix" style={styles.currencyPrefix}>₹</Text>
            <TextInput
              testID="input-declared-value"
              style={[
                styles.textInput,
                styles.valueInput,
                Boolean(fieldErrors.declaredValue) && styles.inputError,
              ]}
              placeholder="0.00"
              placeholderTextColor={colors.outline}
              keyboardType="numeric"
              value={declaredValue}
              onChangeText={handleDeclaredValueChange}
              onFocus={(e) => scrollToInput(e?.target ?? e?.nativeEvent?.target)}
              accessibilityLabel="Declared goods value"
            />
          </View>
          {Boolean(fieldErrors.declaredValue) && (
            <Text style={styles.errorHint} testID="error-declared-value">
              {fieldErrors.declaredValue}
            </Text>
          )}
        </View>

        {/* Special Instructions */}
        <View style={styles.fieldGroup}>
          <View style={styles.labelRow}>
            <Text style={styles.fieldLabel}>Special Instructions</Text>
            <Text style={styles.optionalTag}>(Optional)</Text>
          </View>
          <TextInput
            testID="input-special-instructions"
            style={[styles.textInput, styles.textAreaSmall]}
            placeholder="Any specific handling instructions..."
            placeholderTextColor={colors.outline}
            multiline
            numberOfLines={2}
            value={instructions}
            onChangeText={setInstructions}
            onFocus={(e) => scrollToInput(e?.target ?? e?.nativeEvent?.target)}
            textAlignVertical="top"
            accessibilityLabel="Special instructions"
          />
        </View>
      </KeyboardAwareScrollView>
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
    paddingBottom: spacing.xl,
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
  selectContainer: {
    position: 'relative',
  },
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
  dropdownMenu: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: 12,
    marginTop: spacing.xs,
    maxHeight: 220,
    overflow: 'hidden',
    ...shadows.sm,
  },
  dropdownScroll: {
    maxHeight: 220,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineHairline,
  },
  dropdownItemSelected: {
    backgroundColor: colors.surfaceContainerLow,
  },
  dropdownItemText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  dropdownItemTextSelected: {
    fontWeight: '600',
    color: colors.primary,
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
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.marginMobile,
    paddingBottom: spacing.marginMobile,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant,
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
  continueButtonDisabled: {
    backgroundColor: colors.outlineVariant,
    opacity: 0.6,
  },
  continueText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default GoodsDetailsScreen;
