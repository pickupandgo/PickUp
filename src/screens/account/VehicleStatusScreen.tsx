import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../../components/molecules/AppHeader';
import { useDriverOnboarding } from '../../hooks/useDriverOnboarding';
import {
  DriverOnboardingService,
  type OnboardingDocument,
  type VehicleCategory,
} from '../../services/onboarding/DriverOnboardingService';
import { borderRadius, colors, spacing, typography } from '../../theme';
import type { AccountScreenProps } from '../../types/navigation';

const categories: readonly VehicleCategory[] = [
  'TWO_WHEELER',
  'THREE_WHEELER',
  'FOUR_WHEELER',
  'MINI_TRUCK',
  'PICKUP_TRUCK',
];
const display = (value: string) => value.replace(/_/g, ' ');
const latest = (docs: readonly OnboardingDocument[], type: string) =>
  docs
    .filter(doc => doc.documentType === type)
    .sort((a, b) => b.version - a.version)[0];
export interface VehicleStatusScreenProps {
  readonly navigation: AccountScreenProps<'VehicleStatus'>['navigation'];
  readonly testID?: string;
}

export const VehicleStatusScreen: React.FC<VehicleStatusScreenProps> = ({
  navigation,
  testID,
}) => {
  const { summary, loading, error: loadError, refresh } = useDriverOnboarding();
  const api = DriverOnboardingService.getInstance();
  const replacement =
    summary?.vehicles.find(
      vehicle =>
        !vehicle.active &&
        ['DRAFT', 'REJECTED', 'SUBMITTED', 'IN_REVIEW'].includes(
          vehicle.status,
        ),
    ) ?? null;
  const [category, setCategory] = useState<VehicleCategory>(
    replacement?.category ?? 'TWO_WHEELER',
  );
  const [registration, setRegistration] = useState(
    replacement?.registrationNumber ?? '',
  );
  const [model, setModel] = useState(replacement?.makeModel ?? '');
  const [reason, setReason] = useState('Replacing my current delivery vehicle');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => {
    if (replacement) {
      setCategory(replacement.category);
      setRegistration(replacement.registrationNumber);
      setModel(replacement.makeModel);
    }
  }, [replacement?.id]);
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setActionError(null);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : 'Request failed.',
      );
    } finally {
      setBusy(null);
    }
  };
  const upload = async (type: string) => {
    if (!replacement) return;
    const selected = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.9,
      selectionLimit: 1,
    });
    if (selected.didCancel) return;
    const asset = selected.assets?.[0];
    if (!asset) {
      setActionError(selected.errorMessage ?? 'No document was selected.');
      return;
    }
    await run(`doc-${type}`, () =>
      api.uploadVehicleDocument(replacement.id, type, asset),
    );
  };
  return (
    <SafeAreaView style={styles.safe} testID={testID}>
      <AppHeader
        title="Vehicle status"
        onBackPress={() => navigation.goBack()}
        showBackButton
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
        {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
        {summary?.activeVehicle ? (
          <View style={styles.card}>
            <Text style={styles.heading}>Current approved vehicle</Text>
            <Text style={styles.value}>{summary.activeVehicle.makeModel}</Text>
            <Text style={styles.body}>
              {summary.activeVehicle.registrationNumber} ·{' '}
              {display(summary.activeVehicle.category)}
            </Text>
            <Text style={styles.good}>
              {display(summary.activeVehicle.status)}
            </Text>
          </View>
        ) : null}
        {summary?.activeVehicle && !replacement ? (
          <View style={styles.card}>
            <Text style={styles.heading}>Request vehicle replacement</Text>
            <Text style={styles.body}>
              Your current vehicle stays active until the replacement and its
              evidence are approved.
            </Text>
            <VehicleFields
              category={category}
              registration={registration}
              model={model}
              reason={reason}
              onCategory={setCategory}
              onRegistration={setRegistration}
              onModel={setModel}
              onReason={setReason}
            />
            <Button
              label="Create replacement request"
              busy={busy === 'replace'}
              disabled={
                registration.trim().length < 4 ||
                model.trim().length < 2 ||
                reason.trim().length < 3
              }
              onPress={() =>
                void run('replace', () =>
                  api.requestReplacement({
                    category,
                    registrationNumber: registration,
                    makeModel: model,
                    reason,
                  }),
                )
              }
            />
          </View>
        ) : null}
        {replacement ? (
          <View style={styles.card}>
            <Text style={styles.heading}>Replacement vehicle</Text>
            <Text style={styles.body}>
              Status: {display(replacement.status)}
            </Text>
            {replacement.rejectionReason ? (
              <Text style={styles.error}>{replacement.rejectionReason}</Text>
            ) : null}
            {['DRAFT', 'REJECTED'].includes(replacement.status) ? (
              <>
                <VehicleFields
                  category={category}
                  registration={registration}
                  model={model}
                  reason={reason}
                  hideReason
                  onCategory={setCategory}
                  onRegistration={setRegistration}
                  onModel={setModel}
                  onReason={setReason}
                />
                <Button
                  label="Save replacement details"
                  busy={busy === 'save'}
                  onPress={() =>
                    void run('save', () =>
                      api.updateVehicle(replacement.id, {
                        category,
                        registrationNumber: registration,
                        makeModel: model,
                      }),
                    )
                  }
                />
                {summary?.requiredDocuments.vehicle.map(type => (
                  <View style={styles.document} key={type}>
                    <View style={styles.flex}>
                      <Text style={styles.value}>{display(type)}</Text>
                      <Text style={styles.body}>
                        {display(
                          latest(replacement.documents, type)?.status ??
                            'NOT UPLOADED',
                        )}
                      </Text>
                    </View>
                    <Button
                      compact
                      label={
                        latest(replacement.documents, type)
                          ? 'Replace'
                          : 'Upload'
                      }
                      busy={busy === `doc-${type}`}
                      onPress={() => void upload(type)}
                    />
                  </View>
                ))}
                <Button
                  label="Submit replacement for review"
                  busy={busy === 'submit'}
                  onPress={() =>
                    void run('submit', () => api.submitVehicle(replacement.id))
                  }
                />
              </>
            ) : (
              <Text style={styles.body}>
                The replacement is under administrator review. The current
                approved vehicle remains active.
              </Text>
            )}
          </View>
        ) : null}
        <Button
          label="Refresh"
          secondary
          busy={busy === 'refresh'}
          onPress={() => void run('refresh', refresh)}
        />
      </ScrollView>
    </SafeAreaView>
  );
};

const VehicleFields: React.FC<{
  category: VehicleCategory;
  registration: string;
  model: string;
  reason: string;
  hideReason?: boolean;
  onCategory: (v: VehicleCategory) => void;
  onRegistration: (v: string) => void;
  onModel: (v: string) => void;
  onReason: (v: string) => void;
}> = ({
  category,
  registration,
  model,
  reason,
  hideReason,
  onCategory,
  onRegistration,
  onModel,
  onReason,
}) => (
  <>
    <View style={styles.chips}>
      {categories.map(item => (
        <Pressable
          key={item}
          onPress={() => onCategory(item)}
          style={[styles.chip, item === category && styles.selected]}
        >
          <Text
            style={[styles.chipText, item === category && styles.selectedText]}
          >
            {display(item)}
          </Text>
        </Pressable>
      ))}
    </View>
    <TextInput
      style={styles.input}
      value={registration}
      onChangeText={onRegistration}
      autoCapitalize="characters"
      placeholder="Registration number"
      placeholderTextColor={colors.outline}
    />
    <TextInput
      style={styles.input}
      value={model}
      onChangeText={onModel}
      placeholder="Make and model"
      placeholderTextColor={colors.outline}
    />
    {hideReason ? null : (
      <TextInput
        style={styles.input}
        value={reason}
        onChangeText={onReason}
        placeholder="Reason for replacement"
        placeholderTextColor={colors.outline}
      />
    )}
  </>
);
const Button: React.FC<{
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  secondary?: boolean;
  compact?: boolean;
}> = ({ label, onPress, busy, disabled, secondary, compact }) => (
  <Pressable
    disabled={busy || disabled}
    onPress={onPress}
    style={[
      styles.button,
      secondary && styles.secondary,
      compact && styles.compact,
      (busy || disabled) && styles.disabled,
    ]}
  >
    {busy ? (
      <ActivityIndicator
        color={secondary ? colors.primary : colors.onPrimary}
      />
    ) : (
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>
        {label}
      </Text>
    )}
  </Pressable>
);
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { gap: spacing.gutter, padding: spacing.containerPadding },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    gap: spacing.gutter,
    padding: spacing.containerPadding,
  },
  heading: { ...typography.headlineSm, color: colors.onSurface },
  value: { ...typography.bodyMd, color: colors.onSurface, fontWeight: '600' },
  body: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  good: { ...typography.bodyMd, color: colors.success, fontWeight: '700' },
  error: { ...typography.bodyMd, color: colors.error },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    padding: spacing.xs,
  },
  selected: { backgroundColor: colors.primary },
  chipText: { ...typography.labelSm, color: colors.onSurface },
  selectedText: { color: colors.onPrimary },
  input: {
    ...typography.bodyMd,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    color: colors.onSurface,
    minHeight: 48,
    paddingHorizontal: spacing.gutter,
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.gutter,
  },
  secondary: {
    backgroundColor: colors.surfaceContainerLowest,
    borderColor: colors.primary,
    borderWidth: 1,
  },
  compact: { minHeight: 40 },
  disabled: { opacity: 0.5 },
  buttonText: {
    ...typography.bodyMd,
    color: colors.onPrimary,
    fontWeight: '700',
  },
  secondaryText: { color: colors.primary },
  document: {
    alignItems: 'center',
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.gutter,
    padding: spacing.gutter,
  },
  flex: { flex: 1 },
});
export default VehicleStatusScreen;
