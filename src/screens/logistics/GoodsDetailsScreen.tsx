import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  Keyboard,
  Image,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import { useBooking } from '../../state/BookingContext';
import { KeyboardAwareScrollView } from '../../components/organisms';
import { GoodsTypeDropdown, GOODS_CATEGORIES } from '../../components/molecules';
import { mockVehicleTypes } from '../../data/mockData';
import { getVehicleImage } from '../../utils/vehicleAssets';

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
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(trimmed)) return false;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) && parsed > 0;
};

export const isValidDescription = (val: string): boolean => {
  return val.trim().length > 0 && val.trim().length <= 1000;
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

const GoodsDetailsScreen: React.FC<GoodsDetailsScreenProps & { navigation?: any; route?: any }> = ({
  onBack,
  onContinue,
  navigation,
  route,
}) => {
  const { draft, setGoods, setInsured } = useBooking();
  const insets = useSafeAreaInsets();
  const valueRef = useRef<TextInput>(null);
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(true);
  const vehicle = mockVehicleTypes.find(item => [item.name, item.id, item.category].includes(draft.vehicleType ?? ''));
  useEffect(() => {
    if (route?.params?.focusField !== 'declaredValue') return;
    const timer = setTimeout(() => valueRef.current?.focus(), 250);
    return () => clearTimeout(timer);
  }, [route?.params?.focusField]);
  const keyboardAwareRef = useRef<any>(null);
  const scrollToInput = useCallback((target: any) => {
    keyboardAwareRef.current?.scrollIntoView(target);
  }, []);
  const [selectedType, setSelectedType] = useState<string>(() => draft.goodsType ?? '');

  const [description, setDescription] = useState<string>(() => draft.goodsDescription ?? '');
  const [weight, setWeight] = useState<string>(() => (draft.weightKg !== undefined ? String(draft.weightUnit === 'lbs' ? Number((draft.weightKg / 0.45359237).toFixed(3)) : draft.weightKg) : ''));
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lbs'>(() => draft.weightUnit ?? 'kg');
  const [declaredValue, setDeclaredValue] = useState<string>(() => {
    const raw = draft.declaredValue?.trim();
    if (!raw || raw === '0' || raw === '0.00') return '';
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
      setInsured(false);
      Keyboard.dismiss();
      onContinue?.();
      if (route?.params?.returnToReview) navigation?.goBack();
      else navigation?.navigate('ReviewBookingScreen');
    } finally {
      setIsSubmitting(false);
    }
  };

  return <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
    <View style={styles.header}>
      <Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Go back" onPress={() => onBack ? onBack() : navigation?.goBack()}><Feather name="arrow-left" size={spacing.xxl} color={colors.homeAction} /></Pressable>
      <Text style={[styles.title, styles.headerTitle]}>Goods details</Text>
      <Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Goods details help" onPress={() => Alert.alert('Goods details', 'Choose the goods type and enter a description, approximate weight and estimated goods value. Handling instructions are optional. Insurance is currently unavailable.')}><Feather name="help-circle" size={spacing.xxl} color={colors.homeAction} /></Pressable>
    </View>
    <KeyboardAwareScrollView ref={keyboardAwareRef} style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" footer={<View style={styles.footer}>
      <Pressable testID="goods-details-continue-button" style={[styles.continueButton, !canContinue && styles.disabled]} disabled={!canContinue} onPress={handleContinue} accessibilityRole="button" accessibilityState={{ disabled: !canContinue }} accessibilityLabel="Continue"><Text style={styles.continueText}>{route?.params?.returnToReview ? 'Save changes' : 'Continue'}</Text><Feather name="arrow-right" size={spacing.xxl} color={colors.onPrimary} /></Pressable>
    </View>}>
      {vehicle && <View style={styles.vehicleCard}><Image source={getVehicleImage(draft.vehicleType)} style={styles.vehicleImage} resizeMode="contain" /><View style={styles.flex}><Text style={styles.vehicleTitle}>{vehicle.name}</Text><Text style={styles.helper}>Load capacity {vehicle.capacity.toLowerCase()}</Text></View><Text style={styles.selected}>SELECTED</Text></View>}
      <Text style={styles.heading}>What are you sending?</Text>
      <View style={styles.field}><Text style={styles.label}>Goods type</Text><GoodsTypeDropdown selectedType={selectedType} onSelectType={handleSelectType} error={fieldErrors.type} categories={GOODS_CATEGORIES} placeholder="Select goods type" />{fieldErrors.type && <Text style={styles.error} testID="error-goods-type">{fieldErrors.type}</Text>}</View>
      <View style={styles.field}><Text style={styles.label}>Description</Text><TextInput testID="input-goods-description" maxLength={1000} style={[styles.input, styles.description, !!fieldErrors.description && styles.inputError]} placeholder="e.g. 2 boxes of kitchenware" placeholderTextColor={colors.outline} multiline value={description} onChangeText={handleDescriptionChange} onFocus={e => scrollToInput(e?.target ?? e?.nativeEvent?.target)} textAlignVertical="top" accessibilityLabel="Goods description" /><Text style={styles.helper}>Tell your driver what to expect.</Text>{fieldErrors.description && <Text style={styles.error} testID="error-goods-description">{fieldErrors.description}</Text>}</View>
      <View style={styles.twoColumns}>
        <View style={[styles.field, styles.flex]}><Text style={styles.label}>Approx. weight</Text><View style={[styles.inputFrame, !!fieldErrors.weight && styles.inputError]}><TextInput testID="input-approximate-weight" style={[styles.input, styles.weightInput, !!fieldErrors.weight && styles.inputError]} placeholder="0" placeholderTextColor={colors.outline} keyboardType="decimal-pad" value={weight} onChangeText={handleWeightChange} onFocus={e => scrollToInput(e?.target ?? e?.nativeEvent?.target)} accessibilityLabel="Approximate weight" /><Pressable style={styles.unitSelector} accessibilityRole="button" accessibilityLabel="Choose weight unit" onPress={() => { Keyboard.dismiss(); setUnitsOpen(true); }}><Text style={styles.unitText}>{weightUnit}</Text><Feather name="chevron-down" size={spacing.lg} color={colors.secondary} /></Pressable></View>{fieldErrors.weight && <Text style={styles.error} testID="error-weight">{fieldErrors.weight}</Text>}</View>
        <View style={[styles.field, styles.flex]}><Text style={styles.label}>Declared value</Text><View style={[styles.inputFrame, !!fieldErrors.declaredValue && styles.inputError]}><Text testID="currency-prefix" style={styles.currency}>{'\u20B9'}</Text><TextInput ref={valueRef} testID="input-declared-value" style={[styles.input, styles.valueInput, !!fieldErrors.declaredValue && styles.inputError]} placeholder="0.00" placeholderTextColor={colors.outline} keyboardType="decimal-pad" value={declaredValue} onChangeText={handleDeclaredValueChange} onFocus={e => scrollToInput(e?.target ?? e?.nativeEvent?.target)} accessibilityLabel="Declared goods value" /></View><Text style={styles.helper}>Estimated total value of your goods.</Text>{fieldErrors.declaredValue && <Text style={styles.error} testID="error-declared-value">{fieldErrors.declaredValue}</Text>}</View>
      </View>
      <View style={styles.instructionsCard}><Pressable style={styles.instructionsHeading} accessibilityRole="button" accessibilityLabel="Handling instructions" accessibilityState={{ expanded: instructionsOpen }} onPress={() => setInstructionsOpen(value => !value)}><Feather name="package" size={spacing.xl} color={colors.homeAction} /><Text style={styles.instructionsTitle}>Handling instructions <Text style={styles.optional}>(optional)</Text></Text><Feather name={instructionsOpen ? 'chevron-up' : 'chevron-down'} size={spacing.xl} color={colors.homeAction} /></Pressable>
        {instructionsOpen && <TextInput testID="input-special-instructions" maxLength={1000} style={[styles.input, styles.instructionsInput]} placeholder="e.g. Keep upright, handle with care" placeholderTextColor={colors.outline} multiline value={instructions} onChangeText={setInstructions} onFocus={e => scrollToInput(e?.target ?? e?.nativeEvent?.target)} textAlignVertical="top" accessibilityLabel="Special instructions" />}
      </View>
      <View style={styles.insuranceNote}><Feather name="shield" size={spacing.xxl} color={colors.secondary} /><Text style={[styles.helper, styles.flex]}>Insurance is currently unavailable.{'\n'}No coverage or premium is included.</Text></View>
    </KeyboardAwareScrollView>
    <Modal visible={unitsOpen} transparent animationType="slide" onRequestClose={() => setUnitsOpen(false)}><View style={styles.modalRoot}><Pressable style={styles.backdrop} accessibilityRole="button" accessibilityLabel="Close weight units" onPress={() => setUnitsOpen(false)} /><View style={[styles.unitSheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} accessibilityViewIsModal><Text style={styles.title}>Weight unit</Text>{(['kg', 'lbs'] as const).map(unit => <Pressable key={unit} testID={`unit-toggle-${unit}`} style={styles.unitOption} accessibilityRole="radio" accessibilityLabel={unit === 'kg' ? 'Unit in kilograms' : 'Unit in pounds'} accessibilityState={{ selected: weightUnit === unit }} onPress={() => { setWeightUnit(unit); setUnitsOpen(false); }}><Text style={styles.label}>{unit === 'kg' ? 'Kilograms (kg)' : 'Pounds (lbs)'}</Text>{weightUnit === unit && <Feather name="check-circle" size={spacing.xl} color={colors.homePickup} />}</Pressable>)}</View></View></Modal>
  </SafeAreaView>;
};

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface }, flex: { flex: 1, minWidth: 0 }, scroll: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, minHeight: spacing.rowHeightStandard },
  iconButton: { width: spacing.rowHeightSm + spacing.sm, height: spacing.rowHeightSm + spacing.sm, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.headlineMd, fontWeight: '700', color: colors.homeAction },
  headerTitle: { flex: 1, marginLeft: spacing.sm },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
  vehicleCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.outlineHairline, borderRadius: borderRadius.xl, padding: spacing.md },
  vehicleImage: { width: spacing.rowHeightStandard + spacing.sm, height: spacing.rowHeightStandard },
  vehicleTitle: { ...typography.bodyMd, fontWeight: '700', color: colors.homeAction },
  selected: { ...typography.labelSm, fontSize: 9, fontWeight: '700', color: colors.homePickup, backgroundColor: colors.successContainer, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: borderRadius.full },
  heading: { ...typography.headlineMd, color: colors.homeAction, fontWeight: '700' },
  field: { gap: spacing.sm }, label: { ...typography.bodyMd, color: colors.homeAction, fontWeight: '500' },
  helper: { ...typography.labelSm, color: colors.secondary },
  input: { ...typography.bodyMd, minHeight: spacing.rowHeightSm + spacing.sm, color: colors.homeAction, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant, borderRadius: borderRadius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  description: { minHeight: spacing.rowHeightStandard },
  twoColumns: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  inputFrame: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.outlineVariant, borderRadius: borderRadius.md, overflow: 'hidden' },
  weightInput: { flex: 1, minWidth: 0, borderWidth: 0, paddingHorizontal: spacing.sm },
  unitSelector: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: spacing.rowHeightSm, paddingHorizontal: spacing.sm, borderLeftWidth: 1, borderColor: colors.outlineHairline },
  unitText: { ...typography.bodyMd, color: colors.secondary }, currency: { ...typography.bodyMd, color: colors.homeAction, paddingLeft: spacing.md },
  valueInput: { flex: 1, minWidth: 0, borderWidth: 0, paddingLeft: spacing.sm },
  instructionsCard: { borderWidth: 1, borderColor: colors.outlineHairline, borderRadius: borderRadius.xl, padding: spacing.md, gap: spacing.md },
  instructionsHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: spacing.rowHeightSm },
  instructionsTitle: { ...typography.bodyMd, color: colors.homeAction, fontWeight: '600', flex: 1 }, optional: { ...typography.labelSm, color: colors.secondary, fontWeight: '400' },
  instructionsInput: { minHeight: spacing.rowHeightStandard + spacing.lg },
  insuranceNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  footer: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1, borderColor: colors.outlineHairline, backgroundColor: colors.surface },
  continueButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, minHeight: spacing.rowHeightStandard, backgroundColor: colors.homeAction, borderRadius: borderRadius.lg },
  continueText: { ...typography.bodyLg, color: colors.onPrimary, fontWeight: '600' }, disabled: { opacity: 0.45 },
  error: { ...typography.labelSm, color: colors.error }, inputError: { borderColor: colors.error },
  modalRoot: { flex: 1, justifyContent: 'flex-end' }, backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.black, opacity: 0.4 },
  unitSheet: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.surface, borderTopLeftRadius: borderRadius.xxl, borderTopRightRadius: borderRadius.xxl },
  unitOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: spacing.rowHeightStandard, borderBottomWidth: 1, borderColor: colors.outlineHairline },
});
export default GoodsDetailsScreen;
