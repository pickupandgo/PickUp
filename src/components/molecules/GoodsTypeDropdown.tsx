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
            <View style={styles.sheetContainer} testID="goods-type-dropdown-menu">
              <View style={styles.dragHandleContainer}>
                <View style={styles.dragHandle} />
              </View>

              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Goods/Load Type</Text>
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
                      <Text
                        style={[
                          styles.dropdownItemText,
                          isSelected && styles.dropdownItemTextSelected,
                        ]}
                      >
                        {item}
                      </Text>
                      {isSelected && <Feather name="check" size={20} color={colors.primary} />}
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
    backgroundColor: colors.surfaceVariant,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: 12,
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.md,
  },
  inputError: {
    borderColor: colors.error,
    borderWidth: 1.5,
  },
  selectText: {
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
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetContainer: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl ?? 24,
    borderTopRightRadius: borderRadius.xl ?? 24,
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
    maxHeight: 340,
  },
  dropdownScrollContent: {
    paddingVertical: spacing.xs,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.lg,
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
});

export default GoodsTypeDropdown;
