import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  StyleSheet,
  Modal,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import { useBooking } from '../../state/BookingContext';
import { useI18n } from '../../i18n';
import { GOODS_CATEGORIES, findGoodsCategory, GoodsCategory } from '../../data/goodsCategories';

export interface GoodsDetailsScreenProps {
  readonly onBack?: () => void;
  readonly onContinue?: () => void;
}

const GoodsDetailsScreen: React.FC<GoodsDetailsScreenProps & { navigation?: any }> = ({
  onBack,
  onContinue,
  navigation,
}) => {
  const { draft, setGoods } = useBooking();
  const { t } = useI18n();

  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(() => {
    if (draft.goodsType) return draft.goodsType;
    if (draft.goodsDescription) {
      const match = findGoodsCategory(draft.goodsDescription);
      if (match) return match.id;
    }
    return '';
  });
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [description, setDescription] = useState(() => {
    if (!draft.goodsDescription) return '';
    const match = findGoodsCategory(draft.goodsDescription);
    if (match) return '';
    return draft.goodsDescription;
  });
  const [weight, setWeight] = useState(draft.weightKg ? String(draft.weightKg) : '');
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lbs'>('kg');
  const [declaredValue, setDeclaredValue] = useState(draft.declaredValue || '');
  const [instructions, setInstructions] = useState('');

  const selectedCategory = findGoodsCategory(selectedCategoryId);

  const handleOpenDropdown = () => {
    Keyboard.dismiss();
    setIsDropdownOpen(true);
  };

  const handleCloseDropdown = () => {
    setIsDropdownOpen(false);
  };

  const handleSelectCategory = (category: GoodsCategory) => {
    setSelectedCategoryId(category.id);
    setIsDropdownOpen(false);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
          accessibilityRole="button"
          accessibilityLabel={t('common.goBack')}
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('logistics.goodsDetails')}</Text>
        <Pressable
          style={styles.iconButton}
          onPress={() => navigation?.navigate('ActiveTripChatScreen')}
          accessibilityRole="button"
          accessibilityLabel={t('common.more')}
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
          <Text style={styles.fieldLabel}>{t('logistics.goodsLoadType')}</Text>
          <View style={styles.selectContainer}>
            <Pressable
              style={styles.selectButton}
              onPress={handleOpenDropdown}
              accessibilityRole="button"
              accessibilityLabel={t('logistics.goodsLoadType')}
            >
              <Text style={[styles.selectText, !selectedCategory && styles.selectPlaceholder]}>
                {selectedCategory ? t(selectedCategory.key) : t('logistics.selectGoodsType')}
              </Text>
              <Feather
                name={isDropdownOpen ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={colors.onSurfaceVariant}
              />
            </Pressable>
          </View>
        </View>

        {/* Goods Description */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t('logistics.goodsDescription')}</Text>
          <TextInput
            style={[styles.textInput, styles.textArea]}
            placeholder={t('logistics.goodsDescriptionPlaceholder')}
            placeholderTextColor={colors.outline}
            multiline
            numberOfLines={3}
            value={description}
            onChangeText={setDescription}
            textAlignVertical="top"
            accessibilityLabel={t('logistics.goodsDescription')}
          />
        </View>

        {/* Weight */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, styles.fieldLabelError]}>{t('logistics.approximateWeight')}</Text>
          <View style={styles.weightRow}>
            <TextInput
              style={[styles.textInput, styles.weightInput, styles.inputError]}
              placeholder={t('logistics.enterWeight')}
              placeholderTextColor={colors.outline}
              keyboardType="numeric"
              value={weight}
              onChangeText={setWeight}
              accessibilityLabel={t('logistics.approximateWeight')}
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
          <Text style={styles.errorHint}>{t('logistics.weightRequiredHint')}</Text>
        </View>

        {/* Declared Value */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t('logistics.declaredGoodsValue')}</Text>
          <View style={styles.valueInputWrapper}>
            <Text style={styles.currencyPrefix}>₹</Text>
            <TextInput
              style={[styles.textInput, styles.valueInput]}
              placeholder="0.00"
              placeholderTextColor={colors.outline}
              keyboardType="numeric"
              value={declaredValue}
              onChangeText={setDeclaredValue}
              accessibilityLabel={t('logistics.declaredGoodsValue')}
            />
          </View>
        </View>

        {/* Special Instructions */}
        <View style={styles.fieldGroup}>
          <View style={styles.labelRow}>
            <Text style={styles.fieldLabel}>{t('logistics.specialInstructions')}</Text>
            <Text style={styles.optionalTag}>{t('logistics.optional')}</Text>
          </View>
          <TextInput
            style={[styles.textInput, styles.textAreaSmall]}
            placeholder={t('logistics.handlingInstructionsPlaceholder')}
            placeholderTextColor={colors.outline}
            multiline
            numberOfLines={2}
            value={instructions}
            onChangeText={setInstructions}
            textAlignVertical="top"
            accessibilityLabel={t('logistics.specialInstructions')}
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
              goodsType: selectedCategory?.id,
              goodsDescription: description || (selectedCategory ? t(selectedCategory.key) : undefined),
              declaredValue: declaredValue || undefined,
            });
            onContinue?.();
            navigation?.navigate('GoodsInsuranceScreen');
          }}
          accessibilityRole="button"
          accessibilityLabel={t('common.continue')}
        >
          <Text style={styles.continueText}>{t('common.continueCaps')}</Text>
        </Pressable>
      </View>

      {/* Goods Category Dropdown Modal */}
      <Modal
        visible={isDropdownOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={handleCloseDropdown}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={handleCloseDropdown}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          />
          <View style={styles.sheetContainer}>
            {/* Drag Handle */}
            <View style={styles.dragHandleContainer}>
              <View style={styles.dragHandle} />
            </View>

            {/* Sheet Header */}
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{t('logistics.goodsLoadType')}</Text>
              <Pressable
                style={styles.closeButton}
                onPress={handleCloseDropdown}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <Feather name="x" size={20} color={colors.onSurfaceVariant} />
              </Pressable>
            </View>

            {/* Scrollable Category List */}
            <ScrollView
              style={styles.categoryScroll}
              contentContainerStyle={styles.categoryScrollContent}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
            >
              {GOODS_CATEGORIES.map((category) => {
                const isSelected = selectedCategory?.id === category.id;
                return (
                  <Pressable
                    key={category.id}
                    style={[styles.categoryRow, isSelected && styles.categoryRowSelected]}
                    onPress={() => handleSelectCategory(category)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={t(category.key)}
                  >
                    <Text style={[styles.categoryText, isSelected && styles.categoryTextSelected]}>
                      {t(category.key)}
                    </Text>
                    {isSelected ? (
                      <Feather name="check" size={20} color={colors.primary} />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
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

  // Modal & Dropdown Sheet
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3, 7, 29, 0.5)',
  },
  sheetContainer: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xxl,
    borderTopRightRadius: borderRadius.xxl,
    maxHeight: '75%',
    paddingBottom: spacing.xxl,
    ...shadows.elevated,
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.outlineVariant,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.outlineHairline,
  },
  sheetTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceContainerLow,
  },
  categoryScroll: {
    maxHeight: 380,
  },
  categoryScrollContent: {
    paddingVertical: spacing.xs,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.outlineHairline,
  },
  categoryRowSelected: {
    backgroundColor: colors.secondaryContainer + '55',
  },
  categoryText: {
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
    flex: 1,
  },
  categoryTextSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
});

export default GoodsDetailsScreen;
