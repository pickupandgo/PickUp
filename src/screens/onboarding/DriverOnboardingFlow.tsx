import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Modal,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import Icon from '../../components/atoms/Icon';
import {
  DriverOnboardingService,
  type DriverOnboardingSummary,
  type OnboardingDocument,
  type ProfileInput,
  type UploadProgress,
  type VehicleCategory,
} from '../../services/onboarding/DriverOnboardingService';
import {
  CATEGORY_LABELS,
  documentsReady,
  editableVehicle,
  label,
  latestDocument,
} from '../../services/onboarding/onboardingPresentation';
import {
  Action,
  Badge,
  DocumentCard,
  Field,
  Notice,
  palette,
} from './OnboardingControls';

interface Props {
  readonly summary: DriverOnboardingSummary;
  readonly onRefresh: () => Promise<void>;
  readonly onSignOut: () => Promise<void>;
}
type Step =
  | 'PROFILE'
  | 'CATEGORY'
  | 'KYC'
  | 'VEHICLE'
  | 'REVIEW'
  | 'STATUS'
  | 'HOME'
  | 'HELP';
const TITLES: Record<Step, string> = {
  PROFILE: 'PERSONAL INFORMATION',
  CATEGORY: 'VEHICLE TYPE',
  KYC: 'IDENTITY VERIFICATION',
  VEHICLE: 'VEHICLE DETAILS',
  REVIEW: 'REVIEW & SUBMIT',
  STATUS: 'VERIFICATION STATUS',
  HOME: 'MULTIPLERIDE',
  HELP: 'HELP & SUPPORT',
};
const initialStep = (summary: DriverOnboardingSummary): Step => {
  if (['REJECTED', 'SUSPENDED'].includes(summary.approvalStatus)) return 'HOME';
  if (!(summary.profile?.detailsComplete ?? summary.profileComplete))
    return 'PROFILE';
  if (
    !summary.selectedVehicleCategory &&
    !summary.vehicles.length &&
    summary.availableVehicleCategories
  )
    return 'CATEGORY';
  return summary.next === 'VEHICLE'
    ? 'VEHICLE'
    : summary.next === 'KYC'
    ? 'KYC'
    : 'STATUS';
};
const profileForm = (summary: DriverOnboardingSummary): ProfileInput => ({
  profileVersion: 2,
  name: summary.profile?.name ?? summary.profileName ?? '',
  dateOfBirth: summary.profile?.dateOfBirth ?? '',
  email: summary.profile?.email ?? '',
  residentialAddress: summary.profile?.residentialAddress ?? '',
  city: summary.profile?.city ?? '',
  state: summary.profile?.state ?? '',
  pinCode: summary.profile?.pinCode ?? '',
  ...(summary.profile?.licenceExpiresOn
    ? { licenceExpiresOn: summary.profile.licenceExpiresOn }
    : {}),
  licenceVehicleClasses: summary.profile?.licenceVehicleClasses ?? [],
  ...(summary.profile?.gender ? { gender: summary.profile.gender } : {}),
});
export const DriverOnboardingScreen: React.FC<Props> = ({
  summary,
  onRefresh,
  onSignOut,
}) => {
  const api = DriverOnboardingService.getInstance();
  const [step, setStep] = useState<Step>(() => initialStep(summary));
  const [profile, setProfile] = useState<ProfileInput>(() =>
    profileForm(summary),
  );
  const [licenceClasses, setLicenceClasses] = useState(
    summary.profile?.licenceVehicleClasses.join(', ') ?? '',
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const operation = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [progress, setProgress] = useState<Record<string, UploadProgress>>({});
  const vehicle = editableVehicle(summary.vehicles);
  const syncedVehicleId = useRef(vehicle?.id);
  const [category, setCategory] = useState<VehicleCategory | null>(
    summary.selectedVehicleCategory ?? vehicle?.category ?? null,
  );
  const [registration, setRegistration] = useState(
    vehicle?.registrationNumber ?? '',
  );
  const [makeModel, setMakeModel] = useState(vehicle?.makeModel ?? '');
  const [replacement, setReplacement] = useState(false);
  const [replacementReason, setReplacementReason] = useState('');
  const locked = ['REJECTED', 'SUSPENDED'].includes(summary.approvalStatus);
  const profileLocked =
    locked ||
    summary.approvalStatus === 'APPROVED' ||
    ['IN_REVIEW', 'VERIFIED'].includes(summary.kyc?.status ?? '');
  const kycEditable =
    !locked &&
    ['PENDING', 'NEEDS_CORRECTION'].includes(summary.kyc?.status ?? '');
  const uploadEnabled = summary.capabilities?.documentUploadsEnabled ?? true;
  const kycEnabled =
    summary.capabilities?.manualKycEnabled ??
    summary.kyc?.status !== 'PROVIDER_UNAVAILABLE';
  const requirements = summary.requiredDocuments.vehicleByCategory;
  const vehicleTypes =
    category && requirements
      ? requirements[category] ?? []
      : summary.requiredDocuments.vehicle;
  const currentVehicleTypes =
    vehicle && requirements
      ? requirements[vehicle.category] ?? []
      : summary.requiredDocuments.vehicle;
  const kycReady = documentsReady(
    summary.kyc?.documents ?? [],
    summary.requiredDocuments.kyc,
  );
  const vehicleReady =
    !!vehicle && documentsReady(vehicle.documents, currentVehicleTypes);
  const canEditVehicle =
    !locked && !!vehicle && ['DRAFT', 'REJECTED'].includes(vehicle.status);
  const needsAction =
    locked ||
    !summary.profileComplete ||
    !summary.kyc ||
    [
      'PENDING',
      'REJECTED',
      'NEEDS_CORRECTION',
      'PROVIDER_UNAVAILABLE',
      'EXPIRED',
    ].includes(summary.kyc.status) ||
    !vehicle ||
    ['DRAFT', 'REJECTED'].includes(vehicle.status);
  const verificationTitle = locked
    ? 'Action Required'
    : summary.eligible
    ? 'Approved'
    : !kycEnabled
    ? 'Verification unavailable'
    : needsAction
    ? 'Action Required'
    : 'Under Review';
  const categories =
    summary.availableVehicleCategories ??
    (Object.keys(CATEGORY_LABELS) as VehicleCategory[]);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  useEffect(() => {
    void NativeModules.OnboardingFiles?.pruneTemporary().catch(() => undefined);
    const refresh = () => {
      if (!operation.current)
        void refreshRef
          .current()
          .catch(() =>
            setError('Could not refresh verification status. Please retry.'),
          );
    };
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') refresh();
    }, 20_000);
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active') setPreview(null);
      if (state === 'active') refresh();
    });
    return () => {
      clearInterval(timer);
      listener.remove();
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, []);
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (preview) {
        setPreview(null);
        return true;
      }
      if (step !== 'HOME') {
        setStep('HOME');
        return true;
      }
      return false;
    });
    return () => back.remove();
  }, [step, preview]);
  useEffect(() => {
    if (locked) {
      setStep('HOME');
      setPreview(null);
    }
  }, [locked]);
  useEffect(() => {
    if (syncedVehicleId.current === vehicle?.id) return;
    syncedVehicleId.current = vehicle?.id;
    setRegistration(vehicle?.registrationNumber ?? '');
    setMakeModel(vehicle?.makeModel ?? '');
    if (vehicle) setCategory(vehicle.category);
    setReplacement(false);
  }, [vehicle]);
  const run = async (
    key: string,
    action: () => Promise<unknown>,
    after?: Step,
  ) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(key);
    setError(null);
    try {
      await action();
      await onRefresh();
      if (after) setStep(after);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The request failed. Please retry.',
      );
    } finally {
      operation.current = false;
      setBusy(null);
    }
  };
  const setField = (key: keyof ProfileInput, value: string) => {
    setProfile(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: '' }));
  };
  const saveProfile = () => {
    const nextErrors: Record<string, string> = {};
    if (profile.name.trim().length < 2)
      nextErrors.name = 'Enter your full legal name.';
    const dob = new Date(`${profile.dateOfBirth}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(profile.dateOfBirth) ||
      Number.isNaN(dob.getTime()) ||
      dob.toISOString().slice(0, 10) !== profile.dateOfBirth ||
      dob >= new Date()
    )
      nextErrors.dateOfBirth = 'Enter a valid past date: YYYY-MM-DD.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email))
      nextErrors.email = 'Enter a valid email address.';
    for (const key of ['residentialAddress', 'city', 'state'] as const)
      if (profile[key].trim().length < (key === 'residentialAddress' ? 5 : 2))
        nextErrors[key] = `Enter your ${label(key)}.`;
    if (!/^[1-9][0-9]{5}$/.test(profile.pinCode))
      nextErrors.pinCode = 'Enter a valid six-digit PIN code.';
    setErrors(nextErrors);
    if (!Object.keys(nextErrors).length)
      void run('profile', () => api.updateProfile(profile), 'CATEGORY');
  };
  const selectDocument = (
    kind: 'KYC' | 'VEHICLE',
    ownerId: string,
    type: string,
  ) => {
    const pick = async (camera: boolean) => {
      if (operation.current) return;
      let temporaryUri: string | undefined;
      try {
        const options = {
          mediaType: 'photo' as const,
          quality: 0.9 as const,
          includeExtra: false,
          saveToPhotos: false,
        };
        const result = camera
          ? await launchCamera(options)
          : await launchImageLibrary({ ...options, selectionLimit: 1 });
        if (!result || result.didCancel) return;
        if (result.errorCode)
          throw new Error(
            result.errorCode === 'permission'
              ? 'Camera access is unavailable. Allow camera access in Android settings or choose Gallery.'
              : 'The photo could not be selected. Please retry.',
          );
        const asset = result.assets?.[0];
        if (!asset?.uri) throw new Error('Select a document photograph.');
        temporaryUri = asset.uri;
        const key = `${kind}-${type}`;
        const limits = summary.capabilities
          ? {
              maxBytes: summary.capabilities.maxDocumentBytes,
              allowedContentTypes: summary.capabilities.allowedContentTypes,
            }
          : undefined;
        const onProgress = (value: UploadProgress) =>
          setProgress(current => ({ ...current, [key]: value }));
        await run(key, async () => {
          try {
            if (kind === 'KYC')
              await api.uploadKycDocument(
                ownerId,
                type,
                asset,
                onProgress,
                limits,
              );
            else
              await api.uploadVehicleDocument(
                ownerId,
                type,
                asset,
                onProgress,
                limits,
              );
          } finally {
            setProgress(current => {
              const next = { ...current };
              delete next[key];
              return next;
            });
          }
        });
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'Document selection failed.',
        );
      } finally {
        if (temporaryUri)
          await NativeModules.OnboardingFiles?.removeTemporary(
            temporaryUri,
          ).catch(() => undefined);
      }
    };
    Alert.alert(
      'Add document',
      'Use a clear photograph and follow the approved masking instructions.',
      [
        { text: 'Camera', onPress: () => void pick(true) },
        { text: 'Gallery', onPress: () => void pick(false) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };
  const showPreview = (kind: 'KYC' | 'VEHICLE', document: OnboardingDocument) =>
    void run('preview', async () => {
      const result = await api.previewDocument(kind, document.id);
      if (!['image/png', 'image/jpeg'].includes(result.contentType))
        throw new Error(
          'This evidence format is available for authorized administrator review only.',
        );
      if (!result.url.startsWith('https://'))
        throw new Error('Secure preview is unavailable.');
      if (previewTimer.current) clearTimeout(previewTimer.current);
      setPreview(result.url);
      previewTimer.current = setTimeout(
        () => setPreview(null),
        Math.min(result.expiresInSeconds, 60) * 1000,
      );
    });
  const documents = (
    kind: 'KYC' | 'VEHICLE',
    types: readonly string[],
    records: readonly OnboardingDocument[],
    ownerId: string,
    editable: boolean,
  ) =>
    types.length ? (
      types.map(type => {
        const document = latestDocument(records, type);
        return (
          <DocumentCard
            key={`${kind}-${type}`}
            type={type}
            document={document}
            progress={progress[`${kind}-${type}`]}
            editable={editable && uploadEnabled && !busy}
            onUpload={() => selectDocument(kind, ownerId, type)}
            onPreview={() => document && showPreview(kind, document)}
            onConfirm={
              !locked && !busy && document
                ? () =>
                    void run('confirmation', () =>
                      api.retryDocumentCompletion(kind, ownerId, document.id),
                    )
                : undefined
            }
          />
        );
      })
    ) : (
      <Notice title="Verification unavailable">
        The required document policy is not configured. Uploads and submission
        will be available after approved requirements are published.
      </Notice>
    );
  const go = (next: Step) => {
    setError(null);
    setErrors({});
    setStep(next);
  };
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to onboarding home"
          onPress={() => go('HOME')}
          style={s.headerButton}
        >
          <Icon name="arrow_back" size={23} color={palette.ink} />
        </Pressable>
        <Text style={s.headerTitle}>{TITLES[step]}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Help"
          onPress={() => go('HELP')}
          style={s.headerButton}
        >
          <Icon name="help_outline" size={21} color={palette.ink} />
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={s.grow}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          key={step}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.content}
        >
          {error ? (
            <Notice title="Request could not be completed" danger>
              {error}
            </Notice>
          ) : null}
          {summary.latestDecision?.reason ? (
            <Notice title={label(summary.latestDecision.action)} danger>
              {summary.latestDecision.reason}
            </Notice>
          ) : null}
          {step === 'PROFILE' ? (
            <>
              <Text style={s.step}>STEP 1 OF 4</Text>
              <Text style={s.title}>Let's get to know you.</Text>
              <Text style={s.body}>
                Personal profile — use the details on your approved identity
                evidence.
              </Text>
              {profileLocked ? (
                <Notice title="Profile protected">
                  Your profile is locked during or after review. Request a
                  correction through support.
                </Notice>
              ) : null}
              <Field
                title="Full legal name"
                value={profile.name}
                onChange={value => setField('name', value)}
                error={errors.name}
                editable={!profileLocked}
              />
              <Field
                title="Authenticated mobile number"
                value={summary.profile?.phone ?? 'Confirmed by sign-in'}
                onChange={() => {}}
                editable={false}
              />
              <Field
                title="Date of birth (YYYY-MM-DD)"
                value={profile.dateOfBirth}
                onChange={value => setField('dateOfBirth', value)}
                error={errors.dateOfBirth}
                editable={!profileLocked}
                maxLength={10}
              />
              <Text style={s.caption}>
                Age eligibility is calculated by MultipleRide using the approved
                policy.
              </Text>
              <Text style={s.caption}>Gender (optional)</Text>
              <View style={s.options}>
                {['FEMALE', 'MALE', 'OTHER', 'PREFER_NOT_TO_SAY'].map(value => (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ selected: profile.gender === value }}
                    disabled={profileLocked}
                    key={value}
                    onPress={() => setField('gender', value)}
                    style={[s.option, profile.gender === value && s.selected]}
                  >
                    <Text style={s.optionText}>{label(value)}</Text>
                  </Pressable>
                ))}
              </View>
              <Field
                title="Email address"
                value={profile.email}
                onChange={value => setField('email', value)}
                error={errors.email}
                keyboardType="email-address"
                editable={!profileLocked}
                maxLength={255}
              />
              <Field
                title="Residential address"
                value={profile.residentialAddress}
                onChange={value => setField('residentialAddress', value)}
                error={errors.residentialAddress}
                editable={!profileLocked}
                multiline
                maxLength={500}
              />
              <Field
                title="City"
                value={profile.city}
                onChange={value => setField('city', value)}
                error={errors.city}
                editable={!profileLocked}
                maxLength={100}
              />
              <Field
                title="State"
                value={profile.state}
                onChange={value => setField('state', value)}
                error={errors.state}
                editable={!profileLocked}
                maxLength={100}
              />
              <Field
                title="PIN code"
                value={profile.pinCode}
                onChange={value => setField('pinCode', value)}
                error={errors.pinCode}
                keyboardType="number-pad"
                editable={!profileLocked}
                maxLength={6}
              />
              <Notice title="Driver profile photograph">
                Upload your portrait in the secure identity step when the
                approved policy requires it.
              </Notice>
              <Action
                title="View portrait / identity documents"
                secondary
                onPress={() => go('KYC')}
              />
              <Action
                title="Save and Continue"
                disabled={!!busy || profileLocked || !summary.profile}
                busy={busy === 'profile'}
                onPress={saveProfile}
              />
              {!summary.profile ? (
                <Notice title="Account service update required">
                  Detailed onboarding requires the updated backend contract.
                </Notice>
              ) : null}
            </>
          ) : null}
          {step === 'CATEGORY' ? (
            <>
              <Text style={s.step}>STEP 2 OF 4</Text>
              <Text style={s.body}>
                Select your vehicle category to continue
              </Text>
              {categories.map(item => (
                <Pressable
                  key={item}
                  accessibilityRole="radio"
                  accessibilityLabel={CATEGORY_LABELS[item]}
                  accessibilityState={{ selected: category === item }}
                  disabled={!!busy || locked}
                  onPress={() =>
                    void run('category-draft', async () => {
                      await api.saveVehicleCategory(item);
                      setCategory(item);
                    })
                  }
                  style={[s.category, category === item && s.selected]}
                >
                  <View style={s.iconBox}>
                    <Icon
                      name={
                        item === 'TWO_WHEELER'
                          ? 'two_wheeler'
                          : item === 'THREE_WHEELER'
                          ? 'electric_rickshaw'
                          : 'local_shipping'
                      }
                      size={24}
                      color={palette.ink}
                    />
                  </View>
                  <Text style={s.categoryText}>{CATEGORY_LABELS[item]}</Text>
                  {category === item ? (
                    <Icon name="check_circle" size={22} color={palette.green} />
                  ) : null}
                </Pressable>
              ))}
              <View style={s.spacer} />
              <Action
                title="CONTINUE"
                disabled={!category || locked || !!busy}
                busy={busy === 'category'}
                onPress={() =>
                  category &&
                  void run(
                    'category',
                    () => api.saveVehicleCategory(category),
                    'KYC',
                  )
                }
              />
            </>
          ) : null}
          {step === 'KYC' ? (
            <>
              <Text style={s.step}>STEP 3 OF 4</Text>
              <Text style={s.title}>Identity verification</Text>
              {!kycEnabled ||
              !uploadEnabled ||
              summary.kyc?.status === 'PROVIDER_UNAVAILABLE' ? (
                <Notice title="Identity verification unavailable">
                  Identity verification is securely disabled until approved
                  policy, private storage, and malware scanning are configured.
                </Notice>
              ) : null}
              {summary.kyc?.rejectionReason ? (
                <Notice title="Action Required" danger>
                  {summary.kyc.rejectionReason}
                </Notice>
              ) : null}
              {!summary.kyc ||
              ['EXPIRED', 'REJECTED'].includes(summary.kyc.status) ? (
                <Action
                  title="Start identity verification"
                  disabled={
                    locked || !kycEnabled || !summary.profileComplete || !!busy
                  }
                  busy={busy === 'kyc-start'}
                  onPress={() => void run('kyc-start', () => api.startKyc())}
                />
              ) : null}
              {summary.kyc ? (
                <>
                  <Badge status={summary.kyc.status} />
                  {documents(
                    'KYC',
                    summary.requiredDocuments.kyc,
                    summary.kyc.documents,
                    summary.kyc.id,
                    kycEditable,
                  )}
                </>
              ) : null}
              {summary.capabilities?.licenceNumberEnabled && !profileLocked ? (
                <>
                  <Field
                    title="Driving licence number (optional, protected)"
                    value={profile.drivingLicenseNumber ?? ''}
                    onChange={value =>
                      setField('drivingLicenseNumber', value.toUpperCase())
                    }
                    secureTextEntry
                    maxLength={50}
                  />
                  <Field
                    title="Licence expiry (YYYY-MM-DD, optional)"
                    value={profile.licenceExpiresOn ?? ''}
                    onChange={value => setField('licenceExpiresOn', value)}
                    maxLength={10}
                  />
                  <Field
                    title="Licence vehicle classes (optional, comma-separated)"
                    value={licenceClasses}
                    onChange={setLicenceClasses}
                    maxLength={200}
                  />
                  <Action
                    title="Save licence information"
                    disabled={!!busy}
                    onPress={() =>
                      void run('profile', async () => {
                        await api.updateProfile({
                          ...profile,
                          licenceVehicleClasses: licenceClasses
                            .toUpperCase()
                            .split(',')
                            .map(item => item.trim())
                            .filter(Boolean),
                        });
                        setProfile(current => ({
                          ...current,
                          drivingLicenseNumber: undefined,
                        }));
                      })
                    }
                  />
                </>
              ) : null}
              {kycEditable && summary.requiredDocuments.kyc.length > 0 ? (
                <Action
                  title="Submit KYC for admin review"
                  disabled={!kycReady || !kycEnabled || !!busy}
                  busy={busy === 'kyc-submit'}
                  onPress={() =>
                    summary.kyc &&
                    void run(
                      'kyc-submit',
                      () => api.submitKyc(summary.kyc!.id),
                      'STATUS',
                    )
                  }
                />
              ) : null}
              {summary.kyc?.status === 'VERIFIED' ? (
                <Text style={s.success}>Identity verified</Text>
              ) : null}
              <Action
                title="Continue to vehicle details"
                secondary
                disabled={!summary.profileComplete || locked}
                onPress={() => go('VEHICLE')}
              />
            </>
          ) : null}
          {step === 'VEHICLE' ? (
            <>
              <Text style={s.step}>STEP 4 OF 4</Text>
              <Text style={s.title}>Almost ready to drive.</Text>
              <Text style={s.body}>
                Provide vehicle information and upload the required documents to
                verify your ride.
              </Text>
              <Text style={s.section}>BASIC INFORMATION</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => go('CATEGORY')}
              >
                <Text style={s.link}>
                  {category
                    ? CATEGORY_LABELS[category]
                    : 'Select vehicle category'}
                </Text>
              </Pressable>
              <Field
                title="Manufacturer and model"
                value={makeModel}
                onChange={setMakeModel}
                editable={!vehicle || canEditVehicle || replacement}
                maxLength={100}
              />
              <Field
                title="Registration number"
                value={registration}
                onChange={value => setRegistration(value.toUpperCase())}
                editable={!vehicle || canEditVehicle || replacement}
                maxLength={30}
              />
              <Text style={s.caption}>
                Enter exactly as shown on the RC. Verified vehicle identity
                requires reverification.
              </Text>
              {replacement ? (
                <Field
                  title="Reason for vehicle replacement"
                  value={replacementReason}
                  onChange={setReplacementReason}
                  multiline
                  maxLength={1000}
                />
              ) : null}
              {(!vehicle || canEditVehicle || replacement) && !locked ? (
                <Action
                  title={
                    replacement
                      ? 'Request vehicle replacement'
                      : 'Save vehicle details'
                  }
                  busy={busy === 'vehicle'}
                  disabled={
                    !!busy ||
                    !category ||
                    makeModel.trim().length < 2 ||
                    !/^[A-Z0-9][A-Z0-9 -]{3,29}$/.test(registration) ||
                    (replacement && replacementReason.trim().length < 3)
                  }
                  onPress={() =>
                    category &&
                    void run('vehicle', () => {
                      const input = {
                        category,
                        registrationNumber: registration,
                        makeModel: makeModel.trim(),
                      };
                      return replacement
                        ? api.requestReplacement({
                            ...input,
                            reason: replacementReason,
                          })
                        : canEditVehicle && vehicle
                        ? api.updateVehicle(vehicle.id, input)
                        : api.createVehicle(input);
                    })
                  }
                />
              ) : null}
              {vehicle?.active && !replacement && !locked ? (
                <Action
                  title="Change vehicle — reverification required"
                  secondary
                  onPress={() => {
                    setReplacement(true);
                    setRegistration('');
                    setMakeModel('');
                  }}
                />
              ) : null}
              <Text style={s.section}>REQUIRED DOCUMENTS & PHOTOGRAPHS</Text>
              {!uploadEnabled ? (
                <Notice title="Secure upload unavailable">
                  Uploads are unavailable until secure storage and malware
                  scanning are configured.
                </Notice>
              ) : null}
              {vehicle && !replacement ? (
                documents(
                  'VEHICLE',
                  currentVehicleTypes,
                  vehicle.documents,
                  vehicle.id,
                  canEditVehicle,
                )
              ) : (
                <Notice title="Save vehicle first">
                  {vehicleTypes.length
                    ? `Approved requirements: ${vehicleTypes
                        .map(label)
                        .join(', ')}.`
                    : 'Document requirements for this category have not been published.'}
                </Notice>
              )}
              {vehicle?.rejectionReason ? (
                <Notice title="Action Required" danger>
                  {vehicle.rejectionReason}
                </Notice>
              ) : null}
              {canEditVehicle && !replacement ? (
                <Action
                  title="SUBMIT FOR VERIFICATION →"
                  disabled={!vehicleReady || !!busy}
                  busy={busy === 'vehicle-submit'}
                  onPress={() =>
                    vehicle &&
                    void run(
                      'vehicle-submit',
                      () => api.submitVehicle(vehicle.id),
                      'STATUS',
                    )
                  }
                />
              ) : null}
              <Action
                title="Review saved information"
                secondary
                onPress={() => go('REVIEW')}
              />
            </>
          ) : null}
          {step === 'REVIEW' ? (
            <>
              <Text style={s.title}>Review your saved details</Text>
              <Text style={s.body}>
                This summary shows information saved in your MultipleRide
                account.
              </Text>
              <View style={s.card}>
                <Text style={s.cardTitle}>Personal information</Text>
                <Text style={s.body}>
                  {summary.profile?.name ?? summary.profileName}
                </Text>
                <Text style={s.body}>{summary.profile?.email}</Text>
                <Text style={s.body}>
                  {summary.profile?.residentialAddress}
                </Text>
                <Text style={s.body}>
                  {summary.profile?.city} {summary.profile?.state}{' '}
                  {summary.profile?.pinCode}
                </Text>
                <Text style={s.body}>
                  DOB: {summary.profile?.dateOfBirth ?? 'Not saved'}
                </Text>
                <Action
                  title="View / edit personal information"
                  secondary
                  onPress={() => go('PROFILE')}
                />
              </View>
              <View style={s.card}>
                <Text style={s.cardTitle}>Vehicle</Text>
                <Text style={s.body}>
                  {vehicle
                    ? `${CATEGORY_LABELS[vehicle.category]} · ${
                        vehicle.makeModel
                      } · ${vehicle.registrationNumber}`
                    : 'Vehicle information not saved'}
                </Text>
                <Action
                  title="View / edit vehicle"
                  secondary
                  onPress={() => go('VEHICLE')}
                />
              </View>
              <Text style={s.section}>REMAINING REQUIREMENTS</Text>
              <Text style={s.body}>
                {summary.profile?.detailsComplete
                  ? '✓ Personal details saved'
                  : '• Complete personal information'}
              </Text>
              <Text style={s.body}>
                {summary.kyc?.status === 'VERIFIED'
                  ? '✓ Identity verified'
                  : kycReady
                  ? '• Identity evidence ready for review'
                  : '• Identity evidence or scanning incomplete'}
              </Text>
              <Text style={s.body}>
                {vehicle?.status === 'VERIFIED'
                  ? '✓ Vehicle verified'
                  : vehicleReady
                  ? '• Vehicle evidence ready for review'
                  : '• Vehicle evidence or scanning incomplete'}
              </Text>
              {summary.profile?.ageEligible === null ? (
                <Text style={s.body}>
                  • Approved age policy awaiting configuration
                </Text>
              ) : summary.profile?.ageEligible === false ? (
                <Text style={s.error}>
                  Age does not meet the configured eligibility policy.
                </Text>
              ) : null}
              <Action
                title="Review identity documents"
                secondary
                onPress={() => go('KYC')}
              />
              <Action
                title="Submit ready evidence for review"
                disabled={
                  !!busy ||
                  locked ||
                  (!kycEditable && !canEditVehicle) ||
                  (kycEditable && !kycReady) ||
                  (canEditVehicle && !vehicleReady) ||
                  !kycEnabled
                }
                busy={busy === 'review'}
                onPress={() =>
                  void run(
                    'review',
                    async () => {
                      if (kycEditable && summary.kyc)
                        await api.submitKyc(summary.kyc.id);
                      if (canEditVehicle && vehicle)
                        await api.submitVehicle(vehicle.id);
                    },
                    'STATUS',
                  )
                }
              />
            </>
          ) : null}
          {step === 'STATUS' ? (
            <>
              <Notice
                title={verificationTitle}
                danger={
                  locked ||
                  summary.kyc?.status === 'NEEDS_CORRECTION' ||
                  vehicle?.status === 'REJECTED'
                }
              >
                {summary.eligible
                  ? 'Your account is eligible.'
                  : 'Complete the remaining requirements. Check your profile and review status while verification is pending.'}
              </Notice>
              <Badge status={summary.approvalStatus} />
              <Text style={s.section}>IDENTITY DOCUMENTS</Text>
              {documents(
                'KYC',
                summary.requiredDocuments.kyc,
                summary.kyc?.documents ?? [],
                summary.kyc?.id ?? '',
                false,
              )}
              {summary.kyc?.rejectionReason ? (
                <Notice title="Identity correction" danger>
                  {summary.kyc.rejectionReason}
                </Notice>
              ) : null}
              <Action
                title="View identity / resolve corrections"
                secondary
                disabled={locked}
                onPress={() => go('KYC')}
              />
              <Text style={s.section}>VEHICLE DOCUMENTS</Text>
              {documents(
                'VEHICLE',
                currentVehicleTypes,
                vehicle?.documents ?? [],
                vehicle?.id ?? '',
                false,
              )}
              {vehicle?.rejectionReason ? (
                <Notice title="Vehicle correction" danger>
                  {vehicle.rejectionReason}
                </Notice>
              ) : null}
              <Action
                title="View vehicle / resolve corrections"
                secondary
                disabled={locked}
                onPress={() => go('VEHICLE')}
              />
              <Action
                title="Refresh status"
                busy={busy === 'refresh'}
                disabled={!!busy}
                onPress={() => void run('refresh', async () => {})}
              />
            </>
          ) : null}
          {step === 'HOME' ? (
            <>
              <Text style={s.step}>DRIVER ACCOUNT</Text>
              <Text style={s.title}>
                Welcome, {summary.profileName ?? 'driver'}.
              </Text>
              <Notice
                title={
                  summary.approvalStatus === 'SUSPENDED'
                    ? 'Account suspended'
                    : summary.approvalStatus === 'REJECTED'
                    ? 'Application rejected'
                    : 'Verification in progress'
                }
                danger={locked}
              >
                {locked
                  ? 'New submissions are disabled. Contact support or wait for an administrator to request a correction.'
                  : 'Your account is saved. Trips and going online become available after MultipleRide confirms eligibility.'}
              </Notice>
              <View style={s.card}>
                <Text style={s.cardTitle}>Account status</Text>
                <Badge status={summary.approvalStatus} />
                <Action
                  title="GO ONLINE — APPROVAL REQUIRED"
                  disabled
                  onPress={() => {}}
                />
              </View>
              <Action
                title="Personal profile"
                secondary
                onPress={() => go('PROFILE')}
              />
              <Action
                title="Continue onboarding"
                secondary
                disabled={locked}
                onPress={() => go(initialStep(summary))}
              />
              <Action
                title="Document review status"
                secondary
                onPress={() => go('STATUS')}
              />
              <Action
                title="Help / support"
                secondary
                onPress={() => go('HELP')}
              />
              <Action
                title="Sign out"
                secondary
                onPress={() => void onSignOut()}
              />
            </>
          ) : null}
          {step === 'HELP' ? (
            <>
              <Text style={s.title}>We're here to help.</Text>
              <Text style={s.body}>
                Check each review reason, then return to the identity or vehicle
                step to upload a clear replacement when corrections are allowed.
                For account issues, contact your MultipleRide onboarding team
                using the support channel provided during registration.
              </Text>
              <Notice title="Protect your information">
                Upload evidence only through the secure document workflow. Do
                not send identity documents, OTPs or tokens through ordinary
                support messages.
              </Notice>
              <Action
                title="View verification status"
                onPress={() => go('STATUS')}
              />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={s.tabs}>
        {(
          [
            ['HOME', 'home', 'Home'],
            ['STATUS', 'fact_check', 'Status'],
            ['PROFILE', 'person', 'Profile'],
            ['HELP', 'help_outline', 'Help'],
          ] as const
        ).map(([target, icon, title]) => (
          <Pressable
            key={target}
            accessibilityRole="tab"
            accessibilityState={{ selected: step === target }}
            accessibilityLabel={title}
            onPress={() => go(target)}
            style={s.tab}
          >
            <Icon
              name={icon}
              size={22}
              color={step === target ? '#111111' : palette.muted}
            />
            <Text style={s.tabLabel}>{title}</Text>
          </Pressable>
        ))}
      </View>
      <Modal
        visible={!!preview}
        onRequestClose={() => setPreview(null)}
        animationType="slide"
      >
        <SafeAreaView style={s.safe}>
          <Action
            title="Close private preview"
            onPress={() => setPreview(null)}
          />
          {preview ? (
            <Image
              accessibilityLabel="Your uploaded evidence"
              source={{ uri: preview, cache: 'reload' }}
              resizeMode="contain"
              style={s.grow}
              onError={() => {
                setPreview(null);
                setError('Private preview could not be loaded. Please retry.');
              }}
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAFBFD' },
  grow: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
    minHeight: 56,
  },
  headerButton: {
    width: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    color: palette.ink,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  content: { padding: 20, paddingBottom: 30, flexGrow: 1 },
  step: { fontSize: 11, letterSpacing: 1, color: palette.ink, marginBottom: 8 },
  title: {
    fontSize: 23,
    fontWeight: '700',
    color: palette.ink,
    marginBottom: 12,
  },
  body: { color: palette.ink, fontSize: 13, lineHeight: 21, marginBottom: 15 },
  caption: {
    color: palette.muted,
    fontSize: 11,
    lineHeight: 17,
    marginBottom: 15,
  },
  section: {
    fontSize: 11,
    color: palette.ink,
    letterSpacing: 0.7,
    marginTop: 22,
    marginBottom: 14,
  },
  category: {
    backgroundColor: '#FFFFFF',
    borderColor: palette.line,
    borderWidth: 1,
    padding: 15,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    marginBottom: 13,
    minHeight: 75,
  },
  selected: { borderColor: palette.ink, borderWidth: 2 },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#F3F5F8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  spacer: { flex: 1, minHeight: 30 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 15 },
  option: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 6,
    padding: 10,
  },
  optionText: { color: palette.ink, fontSize: 11 },
  error: { color: palette.red, fontSize: 12, marginVertical: 10 },
  success: {
    color: palette.green,
    fontSize: 14,
    fontWeight: '700',
    marginVertical: 13,
  },
  link: {
    color: palette.ink,
    textDecorationLine: 'underline',
    marginBottom: 18,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 13,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderColor: palette.line,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 58,
    gap: 4,
  },
  tabLabel: { color: palette.muted, fontSize: 10 },
});
