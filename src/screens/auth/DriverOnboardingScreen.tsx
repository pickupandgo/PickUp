import React, { useEffect, useMemo, useState } from 'react';
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
import { borderRadius, colors, spacing, typography } from '../../theme';
import {
  DriverOnboardingService,
  type DriverOnboardingSummary,
  type OnboardingDocument,
  type VehicleCategory,
} from '../../services/onboarding/DriverOnboardingService';

interface Props {
  readonly summary: DriverOnboardingSummary;
  readonly onRefresh: () => Promise<void>;
  readonly onSignOut: () => Promise<void>;
}

const CATEGORIES: readonly VehicleCategory[] = [
  'TWO_WHEELER',
  'THREE_WHEELER',
  'FOUR_WHEELER',
  'MINI_TRUCK',
  'PICKUP_TRUCK',
];
const label = (value: string) =>
  value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());

const latestDocument = (
  documents: readonly OnboardingDocument[],
  type: string,
): OnboardingDocument | undefined =>
  documents
    .filter(document => document.documentType === type)
    .sort((a, b) => b.version - a.version)[0];

export const DriverOnboardingScreen: React.FC<Props> = ({
  summary,
  onRefresh,
  onSignOut,
}) => {
  const api = DriverOnboardingService.getInstance();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileName, setProfileName] = useState(summary.profileName ?? '');
  const editableVehicle = useMemo(
    () =>
      summary.vehicles.find(
        vehicle => vehicle.status === 'DRAFT' || vehicle.status === 'REJECTED',
      ) ?? null,
    [summary.vehicles],
  );
  const [category, setCategory] = useState<VehicleCategory>(
    editableVehicle?.category ?? 'TWO_WHEELER',
  );
  const [registrationNumber, setRegistrationNumber] = useState(
    editableVehicle?.registrationNumber ?? '',
  );
  const [makeModel, setMakeModel] = useState(editableVehicle?.makeModel ?? '');

  useEffect(
    () => setProfileName(summary.profileName ?? ''),
    [summary.profileName],
  );
  useEffect(() => {
    setCategory(editableVehicle?.category ?? 'TWO_WHEELER');
    setRegistrationNumber(editableVehicle?.registrationNumber ?? '');
    setMakeModel(editableVehicle?.makeModel ?? '');
  }, [editableVehicle?.id]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      await onRefresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The request could not be completed.',
      );
    } finally {
      setBusy(null);
    }
  };

  const selectDocument = async (
    type: string,
    kind: 'KYC' | 'VEHICLE',
    ownerId: string,
  ) => {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.9,
      selectionLimit: 1,
    });
    if (result.didCancel) return;
    if (result.errorMessage) {
      setError(result.errorMessage);
      return;
    }
    const asset = result.assets?.[0];
    if (!asset) {
      setError('No document was selected.');
      return;
    }
    await run(`${kind}-${type}`, () =>
      kind === 'KYC'
        ? api.uploadKycDocument(ownerId, type, asset)
        : api.uploadVehicleDocument(ownerId, type, asset),
    );
  };

  const locked =
    summary.approvalStatus === 'REJECTED' ||
    summary.approvalStatus === 'SUSPENDED';
  const kycEditable =
    summary.kyc?.status === 'PENDING' ||
    summary.kyc?.status === 'NEEDS_CORRECTION';
  const vehicle =
    editableVehicle ??
    summary.vehicles.find(item => item.status !== 'INACTIVE') ??
    null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Driver onboarding</Text>
        <Text style={styles.subtitle}>
          Your progress is saved securely and always confirmed by MultipleRide.
        </Text>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        {summary.latestDecision?.reason ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>
              {label(summary.latestDecision.action)}
            </Text>
            <Text style={styles.noticeText}>
              {summary.latestDecision.reason}
            </Text>
          </View>
        ) : null}

        {locked ? (
          <Section
            title={
              summary.approvalStatus === 'SUSPENDED'
                ? 'Account suspended'
                : 'Account rejected'
            }
          >
            <Text style={styles.body}>
              New submissions are disabled. Contact support or wait for an
              administrator to request a correction.
            </Text>
          </Section>
        ) : (
          <>
            <Section
              title="1. Personal profile"
              complete={summary.profileComplete}
            >
              <Field
                label="Full name"
                value={profileName}
                onChangeText={setProfileName}
                placeholder="Name used for your driver profile"
              />
              <Action
                label="Save profile"
                busy={busy === 'profile'}
                disabled={profileName.trim().length < 2}
                onPress={() =>
                  void run('profile', () => api.updateProfile(profileName))
                }
              />
            </Section>

            {summary.profileComplete ? (
              <Section
                title="2. Identity verification"
                complete={summary.kyc?.status === 'VERIFIED'}
              >
                {!summary.kyc ||
                ['REJECTED', 'EXPIRED'].includes(summary.kyc.status) ? (
                  <Action
                    label="Start identity verification"
                    busy={busy === 'kyc-start'}
                    onPress={() => void run('kyc-start', () => api.startKyc())}
                  />
                ) : null}
                {summary.kyc?.status === 'PROVIDER_UNAVAILABLE' ? (
                  <Text style={styles.body}>
                    Identity verification is securely disabled until the
                    approved policy, private storage, and malware scanner are
                    configured.
                  </Text>
                ) : null}
                {summary.kyc?.rejectionReason ? (
                  <Text style={styles.rejection}>
                    {summary.kyc.rejectionReason}
                  </Text>
                ) : null}
                {kycEditable && summary.kyc ? (
                  <>
                    {summary.requiredDocuments.kyc.map(type => (
                      <DocumentRow
                        key={type}
                        type={type}
                        document={latestDocument(summary.kyc!.documents, type)}
                        busy={busy === `KYC-${type}`}
                        onUpload={() =>
                          void selectDocument(type, 'KYC', summary.kyc!.id)
                        }
                      />
                    ))}
                    <Action
                      label="Submit KYC for admin review"
                      busy={busy === 'kyc-submit'}
                      onPress={() =>
                        void run('kyc-submit', () =>
                          api.submitKyc(summary.kyc!.id),
                        )
                      }
                    />
                  </>
                ) : null}
                {summary.kyc?.status === 'IN_REVIEW' ? (
                  <Text style={styles.body}>
                    Your evidence is under authorized administrator review.
                    Approval cannot be performed by the app.
                  </Text>
                ) : null}
                {summary.kyc?.status === 'VERIFIED' ? (
                  <Text style={styles.success}>Identity verified</Text>
                ) : null}
              </Section>
            ) : null}

            {summary.kyc?.status === 'VERIFIED' ? (
              <Section
                title="3. Vehicle verification"
                complete={summary.activeVehicle?.status === 'VERIFIED'}
              >
                {vehicle?.rejectionReason ? (
                  <Text style={styles.rejection}>
                    {vehicle.rejectionReason}
                  </Text>
                ) : null}
                {!vehicle ||
                vehicle.status === 'DRAFT' ||
                vehicle.status === 'REJECTED' ? (
                  <>
                    <Text style={styles.fieldLabel}>Vehicle category</Text>
                    <View style={styles.chips}>
                      {CATEGORIES.map(value => (
                        <Pressable
                          key={value}
                          onPress={() => setCategory(value)}
                          style={[
                            styles.chip,
                            category === value && styles.chipSelected,
                          ]}
                        >
                          <Text
                            style={[
                              styles.chipText,
                              category === value && styles.chipTextSelected,
                            ]}
                          >
                            {label(value)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <Field
                      label="Registration number"
                      value={registrationNumber}
                      onChangeText={setRegistrationNumber}
                      autoCapitalize="characters"
                      placeholder="e.g. MH12AB1234"
                    />
                    <Field
                      label="Make and model"
                      value={makeModel}
                      onChangeText={setMakeModel}
                      placeholder="e.g. Tata Ace"
                    />
                    <Action
                      label={
                        editableVehicle
                          ? 'Save vehicle details'
                          : 'Register vehicle'
                      }
                      busy={busy === 'vehicle-save'}
                      disabled={
                        registrationNumber.trim().length < 4 ||
                        makeModel.trim().length < 2
                      }
                      onPress={() =>
                        void run('vehicle-save', () =>
                          editableVehicle
                            ? api.updateVehicle(editableVehicle.id, {
                                category,
                                registrationNumber,
                                makeModel,
                              })
                            : api.createVehicle({
                                category,
                                registrationNumber,
                                makeModel,
                              }),
                        )
                      }
                    />
                    {editableVehicle ? (
                      <>
                        {summary.requiredDocuments.vehicle.map(type => (
                          <DocumentRow
                            key={type}
                            type={type}
                            document={latestDocument(
                              editableVehicle.documents,
                              type,
                            )}
                            busy={busy === `VEHICLE-${type}`}
                            onUpload={() =>
                              void selectDocument(
                                type,
                                'VEHICLE',
                                editableVehicle.id,
                              )
                            }
                          />
                        ))}
                        <Action
                          label="Submit vehicle for admin review"
                          busy={busy === 'vehicle-submit'}
                          onPress={() =>
                            void run('vehicle-submit', () =>
                              api.submitVehicle(editableVehicle.id),
                            )
                          }
                        />
                      </>
                    ) : null}
                  </>
                ) : null}
                {vehicle &&
                ['SUBMITTED', 'IN_REVIEW'].includes(vehicle.status) ? (
                  <Text style={styles.body}>
                    Vehicle and document review is pending. Your vehicle will
                    not qualify for dispatch until an administrator verifies it.
                  </Text>
                ) : null}
                {summary.activeVehicle?.status === 'VERIFIED' ? (
                  <Text style={styles.success}>
                    Vehicle verified and active
                  </Text>
                ) : null}
              </Section>
            ) : null}

            {summary.next === 'FINAL_REVIEW' ? (
              <Section title="4. Final approval">
                <Text style={styles.body}>
                  Identity and vehicle checks are complete. Final driver
                  approval is pending with an administrator.
                </Text>
              </Section>
            ) : null}
          </>
        )}

        <Action
          label="Refresh status"
          secondary
          busy={busy === 'refresh'}
          onPress={() => void run('refresh', onRefresh)}
        />
        <Action label="Sign out" secondary onPress={() => void onSignOut()} />
      </ScrollView>
    </SafeAreaView>
  );
};

const Section: React.FC<
  React.PropsWithChildren<{ title: string; complete?: boolean }>
> = ({ title, complete, children }) => (
  <View style={styles.section}>
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {complete ? <Text style={styles.complete}>Complete</Text> : null}
    </View>
    {children}
  </View>
);
const Field: React.FC<{
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}> = ({ label: fieldLabel, ...props }) => (
  <View>
    <Text style={styles.fieldLabel}>{fieldLabel}</Text>
    <TextInput
      {...props}
      style={styles.input}
      placeholderTextColor={colors.outline}
    />
  </View>
);
const Action: React.FC<{
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  secondary?: boolean;
}> = ({ label: actionLabel, onPress, busy, disabled, secondary }) => (
  <Pressable
    accessibilityRole="button"
    disabled={busy || disabled}
    onPress={onPress}
    style={[
      styles.action,
      secondary && styles.secondaryAction,
      (busy || disabled) && styles.disabled,
    ]}
  >
    {busy ? (
      <ActivityIndicator
        color={secondary ? colors.primary : colors.onPrimary}
      />
    ) : (
      <Text
        style={[styles.actionText, secondary && styles.secondaryActionText]}
      >
        {actionLabel}
      </Text>
    )}
  </Pressable>
);
const DocumentRow: React.FC<{
  type: string;
  document?: OnboardingDocument;
  busy: boolean;
  onUpload: () => void;
}> = ({ type, document, busy, onUpload }) => (
  <View style={styles.document}>
    <View style={styles.documentText}>
      <Text style={styles.documentTitle}>{label(type)}</Text>
      <Text style={styles.documentStatus}>
        {document ? label(document.status) : 'Not uploaded'}
      </Text>
      {document?.rejectionReason ? (
        <Text style={styles.rejection}>{document.rejectionReason}</Text>
      ) : null}
    </View>
    <Action
      label={document ? 'Replace' : 'Upload'}
      busy={busy}
      onPress={onUpload}
    />
  </View>
);

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.md, gap: spacing.md },
  title: { ...typography.displaySm, color: colors.onSurface },
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    lineHeight: 22,
  },
  section: {
    backgroundColor: colors.surfaceContainerLowest,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    gap: spacing.gutter,
    padding: spacing.containerPadding,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: { ...typography.headlineMd, color: colors.onSurface },
  complete: { ...typography.labelSm, color: colors.success, fontWeight: '700' },
  body: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    lineHeight: 21,
  },
  success: { ...typography.bodyMd, color: colors.success, fontWeight: '700' },
  rejection: { ...typography.bodyMd, color: colors.error, lineHeight: 20 },
  errorBox: {
    backgroundColor: colors.errorContainer,
    borderRadius: borderRadius.md,
    padding: spacing.gutter,
  },
  errorText: { ...typography.bodyMd, color: colors.onErrorContainer },
  notice: {
    backgroundColor: colors.secondaryContainer,
    borderRadius: borderRadius.md,
    gap: spacing.unit,
    padding: spacing.gutter,
  },
  noticeTitle: {
    ...typography.labelSm,
    color: colors.onSecondaryContainer,
    fontWeight: '700',
  },
  noticeText: { ...typography.bodyMd, color: colors.onSecondaryContainer },
  fieldLabel: {
    ...typography.labelSm,
    color: colors.onSurface,
    marginBottom: spacing.unit,
  },
  input: {
    ...typography.bodyMd,
    backgroundColor: colors.surface,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    color: colors.onSurface,
    minHeight: 48,
    paddingHorizontal: spacing.gutter,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.xs,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: { ...typography.labelSm, color: colors.onSurfaceVariant },
  chipTextSelected: { color: colors.onPrimary },
  action: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.gutter,
  },
  secondaryAction: {
    backgroundColor: colors.surfaceContainerLowest,
    borderColor: colors.primary,
    borderWidth: 1,
  },
  disabled: { opacity: 0.5 },
  actionText: {
    ...typography.bodyMd,
    color: colors.onPrimary,
    fontWeight: '700',
  },
  secondaryActionText: { color: colors.primary },
  document: {
    alignItems: 'center',
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.gutter,
    padding: spacing.gutter,
  },
  documentText: { flex: 1, gap: spacing.unit },
  documentTitle: {
    ...typography.bodyMd,
    color: colors.onSurface,
    fontWeight: '600',
  },
  documentStatus: { ...typography.labelSm, color: colors.onSurfaceVariant },
});

export default DriverOnboardingScreen;
