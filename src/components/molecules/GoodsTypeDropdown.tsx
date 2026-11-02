import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Modal,
  StyleSheet,
  Keyboard,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';

export const GOODS_CATEGORIES: readonly string[] = [
  'Furniture',
  'Electronics',
  'Household Goods',
  'Construction Materials',
  'Commercial Goods',
  'Clothing / Apparel',
  'Documents / Parcels',
  'Other',
];

export interface GoodsTypeDropdownProps {
  readonly selectedType: string;
  readonly onSelectType: (type: string) => void;
  readonly error?: string;
  readonly categories?: readonly string[];
  readonly placeholder?: string;
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
}

const GoodsTypeDropdown: React.FC<GoodsTypeDropdownProps> = ({
  selectedType,
  onSelectType,
  error,
  categories = GOODS_CATEGORIES,
  placeholder = 'Select goods type...',
  testID = 'goods-type-selector',
  style,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const categoryIcon = (type: string): string => ({ Furniture: 'sidebar', Electronics: 'monitor', 'Household Goods': 'home', 'Construction Materials': 'layers', 'Commercial Goods': 'shopping-bag', 'Clothing / Apparel': 'shopping-bag', 'Documents / Parcels': 'file-text' }[type] ?? 'package');

  const handleToggle = () => {
    Keyboard.dismiss();
    setIsOpen((prev) => !prev);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  const handleSelect = (category: string) => {
    onSelectType(category);
    setIsOpen(false);
  };

  return (
    <View style={[styles.container, style]}>
      <Pressable
        testID={testID}
        style={[styles.selectButton, Boolean(error) && styles.inputError]}
        onPress={handleToggle}
        accessibilityRole="button"
        accessibilityLabel="Select goods type"
        accessibilityState={{ expanded: isOpen }}
      >
        <Feather name={categoryIcon(selectedType)} size={spacing.xl} color={colors.homeAction} />
        <Text style={[styles.selectText, !selectedType && styles.selectPlaceholder]}>
          {selectedType || placeholder}
        </Text>
        <Feather
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.onSurfaceVariant}
        />
      </Pressable>

      {isOpen && (
        <Modal
          testID="goods-type-dropdown-modal"
          visible={isOpen}
          transparent
          statusBarTranslucent
          animationType="fade"
          onRequestClose={handleClose}
        >
          <View style={styles.modalOverlay}>
            <Pressable
              testID="goods-type-dropdown-backdrop"
              style={styles.modalBackdrop}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Close selection"
            />
            <View style={[styles.sheetContainer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} testID="goods-type-dropdown-menu" accessibilityViewIsModal>
              <View style={styles.dragHandleContainer}>
                <View style={styles.dragHandle} />
              </View>

              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Goods type</Text>
                <Pressable
                  testID="goods-type-close-button"
                  style={styles.closeButton}
                  onPress={handleClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <Feather name="x" size={20} color={colors.onSurfaceVariant} />
                </Pressable>
              </View>

              <ScrollView
                style={styles.dropdownScroll}
                contentContainerStyle={styles.dropdownScrollContent}
                showsVerticalScrollIndicator={true}
                keyboardShouldPersistTaps="handled"
              >
                {categories.map((item) => {
                  const isSelected = selectedType === item;
                  const optionTestId = `goods-type-option-${item.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
                  return (
                    <Pressable
                      key={item}
                      testID={optionTestId}
                      style={[styles.dropdownItem, isSelected && styles.dropdownItemSelected]}
                      onPress={() => handleSelect(item)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={item}
                    >
                      <Feather name={categoryIcon(item)} size={spacing.xxl} color={isSelected ? colors.homePickup : colors.homeAction} />
                      <Text
                        style={[
                          styles.dropdownItemText,
                          isSelected && styles.dropdownItemTextSelected,
                        ]}
                      >
                        {item}
                      </Text>
                      {isSelected && <Feather name="check-circle" size={spacing.xl} color={colors.homePickup} />}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    width: '100%',
  },
  selectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: 12,
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.md,
    minHeight: spacing.rowHeightSm + spacing.sm,
    gap: spacing.md,
  },
  inputError: {
    borderColor: colors.error,
    borderWidth: 1.5,
  },
  selectText: {
    flex: 1,
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  selectPlaceholder: {
    color: colors.outline,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.black,
    opacity: 0.4,
  },
  sheetContainer: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xxl,
    borderTopRightRadius: borderRadius.xxl,
    maxHeight: '70%',
    paddingBottom: spacing.xl,
    ...shadows.elevated,
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.outlineVariant,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.marginMobile,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineHairline,
  },
  sheetTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceVariant,
  },
  dropdownScroll: {
    flexShrink: 1,
  },
  dropdownScrollContent: {
    paddingVertical: spacing.xs,
  },
  dropdownItem: {
    gap: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineHairline,
  },
  dropdownItemSelected: {
    backgroundColor: colors.selectionTint,
  },
  dropdownItemText: {
    flex: 1,
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  dropdownItemTextSelected: {
    fontWeight: '600',
    color: colors.homePickup,
  },
});

export default GoodsTypeDropdown;
