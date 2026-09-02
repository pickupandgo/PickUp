import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import Button from '../../components/atoms/Button';

export interface DeclaredValueSelectionScreenProps {
  readonly onBack?: () => void;
  readonly onClose?: () => void;
  readonly onNext?: (value: string | number) => void;
}

const DECLARED_VALUE_OPTIONS = [
  { id: '1', label: 'Up to ₹5,000', requiresCustom: false },
  { id: '2', label: '₹5,000 - ₹20,000', requiresCustom: false },
  { id: '3', label: '₹20,000 - ₹50,000', requiresCustom: false },
  { id: '4', label: 'Above ₹50,000', requiresCustom: true },
];

const DeclaredValueSelectionScreen: React.FC<DeclaredValueSelectionScreenProps & { navigation?: any }> = ({
  onBack,
  onClose,
  onNext,
  navigation,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customValue, setCustomValue] = useState('');

  const selectedOption = DECLARED_VALUE_OPTIONS.find(opt => opt.id === selectedId);

  const handleNext = () => {
    if (selectedOption?.requiresCustom) {
      onNext?.(customValue);
    } else if (selectedOption) {
      onNext?.(selectedOption.label);
    }
  };

  const isNextDisabled = !selectedId || (selectedOption?.requiresCustom && !customValue);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable style={styles.iconButton} onPress={() => (onBack ? onBack() : navigation?.goBack())}>
          <Feather name="arrow-left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Pick Up</Text>
        <Pressable style={styles.iconButton} onPress={() => (onClose ? onClose() : navigation?.goBack())}>
          <Feather name="x" size={24} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.textSection}>
          <Text style={styles.title}>Declared Value</Text>
          <Text style={styles.subtitle}>
            Declare the value of your goods to protect your shipment. This determines liability coverage.
          </Text>
        </View>

        <View style={styles.chipsGrid}>
          {DECLARED_VALUE_OPTIONS.map((option) => {
            const isSelected = selectedId === option.id;
            return (
              <Pressable
                key={option.id}
                style={[
                  styles.chip,
                  isSelected ? styles.chipSelected : styles.chipUnselected,
                ]}
                onPress={() => setSelectedId(option.id)}
              >
                <Text
                  style={[
                    styles.chipText,
                    isSelected ? styles.chipTextSelected : styles.chipTextUnselected,
                  ]}
                >
                  {option.label}
                </Text>
                {isSelected && (
                  <MaterialIcons name="check-circle" size={20} color={colors.onPrimaryContainer} />
                )}
              </Pressable>
            );
          })}
        </View>

        {selectedOption?.requiresCustom && (
          <View style={styles.customValueSection}>
            <Text style={styles.customValueLabel}>Enter exact value</Text>
            <View style={styles.inputContainer}>
              <Text style={styles.currencySymbol}>₹</Text>
              <TextInput
                style={styles.textInput}
                placeholder="0"
                placeholderTextColor={colors.onSurfaceVariant}
                keyboardType="numeric"
                value={customValue}
                onChangeText={setCustomValue}
              />
            </View>
            <View style={styles.infoRow}>
              <Feather name="info" size={14} color={colors.outline} />
              <Text style={styles.infoText}>Values above ₹50k require additional verification.</Text>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label="Next"
          onPress={() => {
            handleNext();
            navigation?.goBack();
          }}
          variant="primary"
          icon={<Feather name="arrow-right" size={20} color={colors.onPrimary} />}
          disabled={isNextDisabled}
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
    paddingBottom: spacing.xxxl,
    gap: spacing.xl,
  },
  textSection: {
    gap: spacing.xs,
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  subtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  chipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    width: '48%', // two columns roughly
    flexGrow: 1,
    minWidth: 150,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
  },
  chipUnselected: {
    backgroundColor: colors.surfaceContainerLow,
    borderColor: 'transparent',
  },
  chipSelected: {
    backgroundColor: colors.primaryContainer,
    borderColor: colors.primaryContainer,
  },
  chipText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    fontFamily: typography.headlineSm.fontFamily,
    flex: 1,
  },
  chipTextUnselected: {
    color: colors.onSurfaceVariant,
  },
  chipTextSelected: {
    color: colors.onPrimaryContainer,
  },
  customValueSection: {
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  customValueLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  inputContainer: {
    position: 'relative',
    justifyContent: 'center',
  },
  currencySymbol: {
    position: 'absolute',
    left: spacing.md,
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.headlineSm.fontFamily,
    zIndex: 10,
  },
  textInput: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.md,
    paddingLeft: 40,
    paddingRight: spacing.md,
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  infoText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.outline,
    fontFamily: typography.labelSm.fontFamily,
  },
  footer: {
    padding: spacing.marginMobile,
    backgroundColor: colors.surfaceContainerLowest,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainer,
    ...shadows.card,
  },
});

export default DeclaredValueSelectionScreen;
