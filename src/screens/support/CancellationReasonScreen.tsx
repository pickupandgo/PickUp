import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';
import Button from '../../components/atoms/Button';

export interface CancellationReasonScreenProps {
  readonly onSubmit?: (reasonId: string, otherReasonText?: string) => void;
  readonly onBack?: () => void;
  readonly onHelp?: () => void;
}

const CANCELLATION_REASONS = [
  { id: 'driver_requested', label: 'Driver requested cancellation' },
  { id: 'driver_not_moving', label: 'Driver is not moving' },
  { id: 'long_wait', label: 'Longer wait time than expected' },
  { id: 'changed_mind', label: 'Changed my mind' },
  { id: 'wrong_location', label: 'Incorrect pickup location' },
  { id: 'other', label: 'Other' },
];

const CancellationReasonScreen: React.FC<CancellationReasonScreenProps & { navigation?: any }> = ({
  onSubmit,
  onBack,
  onHelp,
  navigation,
}) => {
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');

  const handleSubmit = () => {
    if (selectedReason) {
      onSubmit?.(selectedReason, selectedReason === 'other' ? otherText : undefined);
    }
  };

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
        <Text style={styles.headerTitle} numberOfLines={1}>Reason for Cancellation</Text>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onHelp ? onHelp() : navigation?.navigate('ActiveTripChatScreen'))}
        >
          <Feather name="help-circle" size={24} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.introSection}>
          <Text style={styles.introText}>
            Please let us know why you're cancelling to help us improve.
          </Text>
        </View>

        {/* Cancellation Options */}
        <View style={styles.optionsCard}>
          {CANCELLATION_REASONS.map((reason, index) => {
            const isSelected = selectedReason === reason.id;
            const isLast = index === CANCELLATION_REASONS.length - 1;

            return (
              <Pressable
                key={reason.id}
                style={[
                  styles.optionRow,
                  !isLast && styles.optionRowBorder
                ]}
                onPress={() => setSelectedReason(reason.id)}
              >
                <Text style={[
                  styles.optionLabel,
                  isSelected && styles.optionLabelSelected
                ]}>
                  {reason.label}
                </Text>
                <View style={[
                  styles.radioOuter,
                  isSelected && styles.radioOuterSelected
                ]}>
                  {isSelected && <Feather name="check" size={12} color={colors.onPrimary} />}
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Other Text Area */}
        {selectedReason === 'other' && (
          <View style={styles.otherInputContainer}>
            <TextInput
              style={styles.textInput}
              placeholder="Please specify..."
              placeholderTextColor={colors.onSurfaceVariant}
              value={otherText}
              onChangeText={setOtherText}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>
        )}
      </ScrollView>

      {/* Bottom Action */}
      <View style={styles.bottomActions}>
        <Button
          label="SUBMIT"
          onPress={() => {
            handleSubmit();
            navigation?.navigate('CancellationChargeConfirmationScreen');
          }}
          variant="primary"
          fullWidth
          size="lg"
          disabled={!selectedReason || (selectedReason === 'other' && otherText.trim().length === 0)}
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
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
    textAlign: 'center',
    marginHorizontal: spacing.md,
  },
  scrollContent: {
    padding: spacing.marginMobile,
    paddingBottom: spacing.xxxl * 2,
  },
  introSection: {
    alignItems: 'center',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  introText: {
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyLg.fontFamily,
    textAlign: 'center',
  },
  optionsCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.outlineVariant + '4D', // 30% opacity
    ...shadows.card,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  optionRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant + '33', // 20% opacity
  },
  optionLabel: {
    flex: 1,
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
  },
  optionLabelSelected: {
    color: colors.primary,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  otherInputContainer: {
    marginTop: spacing.xl,
  },
  textInput: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
    minHeight: 96,
  },
  bottomActions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface + 'E6', // 90% opacity
    padding: spacing.marginMobile,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant + '33', // 20% opacity
  },
});

export default CancellationReasonScreen;
