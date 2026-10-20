import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { cancellationReasons } from '../../data/mockData';
import { AppHeader } from '../../components/molecules/AppHeader';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { useI18n } from '../../i18n';
import type { HomeScreenProps } from '../../types/navigation';

/**
 * CancellationReasonScreen
 * Allows driver to select a reason before cancelling an active trip.
 */
export interface CancellationReasonScreenProps {
  readonly navigation: HomeScreenProps<'CancellationReason'>['navigation'];
  readonly route: HomeScreenProps<'CancellationReason'>['route'];
  readonly testID?: string;
}

export const CancellationReasonScreen: React.FC<CancellationReasonScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { t } = useI18n();
  const { tripId } = route.params;
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [otherDetails, setOtherDetails] = useState('');

  const reasonLabelMap: Record<string, string> = {
    breakdown: t('cancellation.reasonBreakdown'),
    customer_unavailable: t('cancellation.reasonCustomerUnavailable'),
    wrong_address: t('cancellation.reasonWrongAddress'),
    safety_concern: t('cancellation.reasonSafetyConcern'),
    other: t('cancellation.reasonOther'),
  };

  const handleConfirm = useCallback(() => {
    if (!selectedReason) return;
    navigation.navigate('CancellationProcessing', {
      tripId,
      reason: selectedReason,
    });
  }, [navigation, tripId, selectedReason]);

  const renderItem = ({ item }: { item: { readonly id: string; readonly label: string } }) => {
    const isSelected = item.id === selectedReason;
    const label = reasonLabelMap[item.id] || item.label;
    return (
      <Pressable
        style={[styles.reasonRow, isSelected && styles.reasonRowSelected]}
        onPress={() => setSelectedReason(item.id)}
        accessibilityRole="radio"
        accessibilityState={{ selected: isSelected }}
      >
        <View style={[styles.radio, isSelected && styles.radioSelected]}>
          {isSelected ? <View style={styles.radioInner} /> : null}
        </View>
        <Text style={[styles.reasonText, isSelected && styles.reasonTextSelected]}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title={t('cancellation.title')}
        onBackPress={() => navigation.goBack()}
        showBackButton
      />
      <View style={styles.container}>
        <Text style={styles.subtitle}>{t('cancellation.subtitle')}</Text>

        <FlatList
          data={cancellationReasons as unknown as { readonly id: string; readonly label: string }[]}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />

        {selectedReason === 'other' ? (
          <TextInput
            style={styles.otherInput}
            placeholder={t('cancellation.placeholder')}
            placeholderTextColor={colors.outline}
            value={otherDetails}
            onChangeText={setOtherDetails}
            multiline
            numberOfLines={3}
          />
        ) : null}

        <PrimaryButton
          label={t('cancellation.confirm')}
          onPress={handleConfirm}
          disabled={!selectedReason}
          style={styles.confirmButton}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.containerPadding,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    marginTop: spacing.gutter,
    marginBottom: spacing.containerPadding,
  },
  list: {
    paddingBottom: spacing.containerPadding,
  },
  separator: {
    height: 1,
    backgroundColor: colors.outlineVariant,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.containerPadding,
    gap: spacing.gutter,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.xs,
  },
  reasonRowSelected: {
    backgroundColor: colors.surfaceContainerLow,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: colors.error,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.error,
  },
  reasonText: {
    ...typography.bodyMd,
    color: colors.onSurface,
    flex: 1,
  },
  reasonTextSelected: {
    fontWeight: '500',
  },
  otherInput: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    padding: spacing.containerPadding,
    ...typography.bodyMd,
    color: colors.onSurface,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: spacing.containerPadding,
  },
  confirmButton: {
    marginBottom: spacing.lg,
    backgroundColor: colors.error,
  },
});

export default CancellationReasonScreen;
