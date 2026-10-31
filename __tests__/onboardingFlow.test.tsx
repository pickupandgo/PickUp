import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Alert, Text } from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { DriverOnboardingScreen } from '../src/screens/onboarding/DriverOnboardingFlow';
import {
  DriverOnboardingService,
  type DriverOnboardingSummary,
  type OnboardingDocument,
} from '../src/services/onboarding/DriverOnboardingService';
import {
  documentState,
  documentsReady,
  latestDocument,
} from '../src/services/onboarding/onboardingPresentation';

const base: DriverOnboardingSummary = {
  driverId: 'driver',
  approvalStatus: 'PENDING',
  profileComplete: true,
  profileName: 'Test Driver',
  selectedVehicleCategory: 'MINI_TRUCK',
  availableVehicleCategories: ['TWO_WHEELER', 'MINI_TRUCK'],
  eligible: false,
  eligibilityReasons: ['DRIVER_NOT_APPROVED'],
  next: 'KYC',
  profile: {
    name: 'Test Driver',
    phone: '+919999999999',
    dateOfBirth: '1990-01-01',
    email: 'a@example.test',
    gender: null,
    residentialAddress: '123 Test Road',
    city: 'Test City',
    state: 'Test State',
    pinCode: '342001',
    detailsComplete: true,
    age: 36,
    ageEligible: null,
    minimumAge: null,
    licenceLast4: null,
    licenceExpiresOn: null,
    licenceVehicleClasses: [],
  },
  capabilities: {
    manualKycEnabled: true,
    documentUploadsEnabled: true,
    maxDocumentBytes: 1000000,
    allowedContentTypes: ['image/jpeg'],
    licenceNumberEnabled: false,
  },
  kyc: {
    id: 'kyc',
    provider: 'MANUAL_ADMIN_VERIFICATION',
    status: 'PENDING',
    documents: [],
  },
  vehicles: [],
  activeVehicle: null,
  requiredDocuments: { kyc: ['TEST_PORTRAIT'], vehicle: ['TEST_RC'] },
  latestDecision: null,
};
const content = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root
    .findAllByType(Text)
    .map(n => n.props.children)
    .flat(Infinity)
    .filter(v => typeof v === 'string')
    .join(' ');
const button = (renderer: TestRenderer.ReactTestRenderer, title: string) =>
  renderer.root.findAll(
    n =>
      n.props.accessibilityLabel === title &&
      typeof n.props.onPress === 'function',
  )[0]!;
describe('Professional onboarding navigation and security states', () => {
  let rendered: TestRenderer.ReactTestRenderer;
  const refresh = jest.fn(async () => undefined);
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });
  afterEach(async () => {
    if (rendered) await TestRenderer.act(() => rendered.unmount());
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  const render = async (overrides: Partial<DriverOnboardingSummary> = {}) => {
    await TestRenderer.act(() => {
      rendered = TestRenderer.create(
        <DriverOnboardingScreen
          summary={{ ...base, ...overrides }}
          onRefresh={refresh}
          onSignOut={async () => {}}
        />,
      );
    });
  };
  it('shows actual upload controls but never permits incomplete KYC submission', async () => {
    await render();
    expect(content(rendered)).toContain('NOT UPLOADED');
    expect(button(rendered, 'Submit KYC for admin review').props.disabled).toBe(
      true,
    );
    expect(button(rendered, 'Upload Test Portrait')).toBeDefined();
  });
  it('uses backend pending scan state and keeps submission disabled', async () => {
    await render({
      kyc: {
        ...base.kyc!,
        documents: [
          {
            id: 'doc',
            documentType: 'TEST_PORTRAIT',
            version: 1,
            status: 'QUARANTINED',
            scannedAt: null,
            createdAt: '2026-01-01',
          },
        ],
      },
    });
    expect(content(rendered)).toContain('Malware scan pending');
    expect(button(rendered, 'Submit KYC for admin review').props.disabled).toBe(
      true,
    );
  });
  it('offers camera/gallery selection and handles cancellation without creating an upload', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const upload = jest.spyOn(
      DriverOnboardingService.getInstance(),
      'uploadKycDocument',
    );
    (launchCamera as jest.Mock).mockResolvedValue({ didCancel: true });
    (launchImageLibrary as jest.Mock).mockResolvedValue({ didCancel: true });
    await render();
    await TestRenderer.act(() =>
      button(rendered, 'Upload Test Portrait').props.onPress(),
    );
    const options = alert.mock.calls[0][2]!;
    expect(options.map(o => o.text)).toEqual(['Camera', 'Gallery', 'Cancel']);
    await TestRenderer.act(async () => {
      options[0].onPress?.();
    });
    expect(launchCamera).toHaveBeenCalledWith(
      expect.objectContaining({ saveToPhotos: false, includeExtra: false }),
    );
    expect(upload).not.toHaveBeenCalled();
  });
  it('allows a restricted dashboard with dispatch unavailable', async () => {
    await render();
    await TestRenderer.act(() => button(rendered, 'Home').props.onPress());
    expect(
      button(rendered, 'GO ONLINE — APPROVAL REQUIRED').props.disabled,
    ).toBe(true);
    expect(content(rendered)).not.toContain('Accept booking');
    await TestRenderer.act(() => button(rendered, 'Status').props.onPress());
    expect(content(rendered)).toContain('VERIFICATION STATUS');
  });
  it('leaves category Continue disabled until a supported option is selected', async () => {
    await render({ selectedVehicleCategory: null });
    expect(content(rendered)).toContain('VEHICLE TYPE');
    expect(button(rendered, 'CONTINUE').props.disabled).toBe(true);
    const save = jest
      .spyOn(DriverOnboardingService.getInstance(), 'saveVehicleCategory')
      .mockResolvedValue({});
    await TestRenderer.act(async () => {
      button(rendered, 'Mini Truck / Tata Ace').props.onPress();
    });
    await TestRenderer.act(async () =>
      button(rendered, 'CONTINUE').props.onPress(),
    );
    expect(save).toHaveBeenCalledWith('MINI_TRUCK');
    expect(refresh).toHaveBeenCalled();
    expect(content(rendered)).toContain('IDENTITY VERIFICATION');
  });
  it('shows rejection reason without a locally fabricated approval', async () => {
    await render({
      kyc: {
        ...base.kyc!,
        status: 'NEEDS_CORRECTION',
        rejectionReason: 'Synthetic unreadable evidence',
        documents: [],
      },
    });
    expect(content(rendered)).toContain('Synthetic unreadable evidence');
    expect(content(rendered)).not.toContain('Identity verified');
  });
});
describe('Document lifecycle presentation', () => {
  const doc: OnboardingDocument = {
    id: 'doc',
    documentType: 'TEST',
    version: 1,
    status: 'QUARANTINED',
    createdAt: '2026-01-01',
    scannedAt: null,
  };
  it('requires a real clean scan and keeps clean separate from human verification', () => {
    expect(documentState(doc)).toBe('SCANNING');
    expect(documentsReady([doc], ['TEST'])).toBe(false);
    expect(documentState({ ...doc, scannedAt: '2026-01-01' })).toBe(
      'PENDING_REVIEW',
    );
    expect(
      documentsReady([{ ...doc, scannedAt: '2026-01-01' }], ['TEST']),
    ).toBe(true);
    expect(documentsReady([], [])).toBe(false);
  });
  it('uses the newest document version even if older evidence was verified', () => {
    const docs = [
      { ...doc, status: 'VERIFIED' as const },
      { ...doc, id: 'new', version: 2, status: 'REJECTED' as const },
    ];
    expect(latestDocument(docs, 'TEST')?.id).toBe('new');
    expect(documentsReady(docs, ['TEST'])).toBe(false);
  });
});
