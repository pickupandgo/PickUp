import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import { DriverOnboardingScreen } from '../src/screens/auth/DriverOnboardingScreen';
import type { DriverOnboardingSummary } from '../src/services/onboarding/DriverOnboardingService';

const summary = (
  overrides: Partial<DriverOnboardingSummary> = {},
): DriverOnboardingSummary => ({
  driverId: 'driver-1',
  approvalStatus: 'PENDING',
  profileComplete: false,
  profileName: null,
  eligible: false,
  eligibilityReasons: ['DRIVER_NOT_APPROVED'],
  next: 'PROFILE',
  kyc: null,
  vehicles: [],
  activeVehicle: null,
  requiredDocuments: { kyc: ['IDENTITY'], vehicle: ['RC'] },
  latestDecision: null,
  ...overrides,
});
const text = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(Infinity)
    .filter(value => typeof value === 'string')
    .join(' ');

describe('DriverOnboardingScreen', () => {
  it('renders the resumable profile step from backend state', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <DriverOnboardingScreen
          summary={summary()}
          onRefresh={async () => undefined}
          onSignOut={async () => undefined}
        />,
      );
    });
    expect(text(renderer)).toContain('Personal profile');
    expect(text(renderer)).toContain('Save profile');
  });
  it('does not offer onboarding mutations to a suspended driver', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <DriverOnboardingScreen
          summary={summary({ approvalStatus: 'SUSPENDED' })}
          onRefresh={async () => undefined}
          onSignOut={async () => undefined}
        />,
      );
    });
    expect(text(renderer)).toContain('Account suspended');
    expect(text(renderer)).not.toContain('Save profile');
  });
  it('shows KYC as unavailable instead of fabricating success', async () => {
    const state = summary({
      profileComplete: true,
      profileName: 'Test Driver',
      next: 'KYC',
      kyc: {
        id: 'kyc-1',
        provider: 'UNCONFIGURED',
        status: 'PROVIDER_UNAVAILABLE',
        rejectionReason: null,
        documents: [],
      },
    });
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <DriverOnboardingScreen
          summary={state}
          onRefresh={async () => undefined}
          onSignOut={async () => undefined}
        />,
      );
    });
    expect(text(renderer)).toContain('securely disabled');
    expect(text(renderer)).not.toContain('Identity verified');
  });
});
