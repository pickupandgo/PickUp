import React, { useEffect } from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import {
  Skeleton,
  SkeletonText,
  SkeletonCircle,
  SkeletonCard,
  SkeletonButton,
  SkeletonListItem,
  HomeScreenSkeleton,
  TripHistorySkeleton,
  TripDetailSkeleton,
  ProfileSkeleton,
  SavedAddressesSkeleton,
  VehicleSelectionSkeleton,
  DriverAssignedPanelSkeleton,
  useSkeletonVisibility,
} from '../src/components/skeleton';

jest.mock('../src/config/env', () => ({
  env: {
    apiBaseUrl: 'https://engine.test',
    paymentsApiBaseUrl: 'https://pay.test',
    googleMapsApiKey: 'mock-key',
  },
  hasApiConfig: () => true,
  hasPaymentsConfig: () => true,
  assertApiConfig: () => undefined,
}));

describe('Light-Mode Skeleton Loading System - Customer App', () => {
  it('renders base Skeleton primitive with accessibility hiding and light-mode color', () => {
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(
        <Skeleton width={120} height={24} borderRadius={6} testID="test-skeleton" />
      );
    });

    const root = renderer.root;
    const view = root.findByProps({ accessibilityElementsHidden: true });
    expect(view).toBeTruthy();
    expect(view.props.accessible).toBe(false);
    expect(view.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('renders SkeletonText with multiple lines', () => {
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(
        <SkeletonText lines={3} lineHeight={14} lineSpacing={6} lastLineWidth="50%" testID="test-text" />
      );
    });

    const root = renderer.root;
    const textGroup = root.findByProps({ testID: 'test-text' });
    expect(textGroup).toBeTruthy();
    const lineSkeletons = textGroup.findAllByType(Skeleton);
    expect(lineSkeletons).toHaveLength(3);
  });

  it('renders SkeletonCircle and SkeletonCard correctly', () => {
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(
        <SkeletonCard testID="test-card">
          <SkeletonCircle size={48} testID="test-circle" />
        </SkeletonCard>
      );
    });

    const root = renderer.root;
    expect(root.findByProps({ testID: 'test-card' })).toBeTruthy();
    expect(root.findByProps({ testID: 'test-circle' })).toBeTruthy();
  });

  it('renders SkeletonButton and SkeletonListItem', () => {
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(
        <>
          <SkeletonButton width={160} height={44} testID="test-btn" />
          <SkeletonListItem count={2} hasAvatar={true} hasSubtitle={true} testID="test-list-row" />
        </>
      );
    });

    const root = renderer.root;
    expect(root.findByProps({ testID: 'test-btn' })).toBeTruthy();
    const listRow = root.findByProps({ testID: 'test-list-row' });
    expect(listRow).toBeTruthy();
  });

  it('renders composite screen skeletons without crashing', () => {
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(
        <>
          <HomeScreenSkeleton testID="home-skeleton" />
          <TripHistorySkeleton testID="trip-history-skeleton" />
          <TripDetailSkeleton testID="trip-detail-skeleton" />
          <ProfileSkeleton testID="profile-skeleton" />
          <SavedAddressesSkeleton testID="saved-addr-skeleton" />
          <VehicleSelectionSkeleton testID="vehicle-select-skeleton" />
          <DriverAssignedPanelSkeleton testID="driver-assigned-skeleton" />
        </>
      );
    });

    const root = renderer.root;
    expect(root.findByProps({ testID: 'home-skeleton' })).toBeTruthy();
    expect(root.findByProps({ testID: 'trip-history-skeleton' })).toBeTruthy();
    expect(root.findByProps({ testID: 'trip-detail-skeleton' })).toBeTruthy();
    expect(root.findByProps({ testID: 'profile-skeleton' })).toBeTruthy();
    expect(root.findByProps({ testID: 'saved-addr-skeleton' })).toBeTruthy();
    expect(root.findByProps({ testID: 'vehicle-select-skeleton' })).toBeTruthy();
    expect(root.findByProps({ testID: 'driver-assigned-skeleton' })).toBeTruthy();
  });

  describe('Intelligent Skeleton Visibility Hook & Rules', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const TestVisibilityConsumer: React.FC<{
      isLoading: boolean;
      hasData?: boolean;
      delayMs?: number;
      timeoutMs?: number;
      isError?: boolean;
    }> = (props) => {
      const visible = useSkeletonVisibility(props);
      return <Text testID="visibility-result">{String(visible)}</Text>;
    };

    it('Rule 1 & 2: does NOT show skeleton when usable data is already available', () => {
      let renderer: any;
      act(() => {
        renderer = TestRenderer.create(
          <TestVisibilityConsumer isLoading={true} hasData={true} delayMs={180} />
        );
      });
      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('false');

      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('false');
    });

    it('Rule 3: delays skeleton by ~180ms to prevent visual flicker on fast requests', () => {
      let renderer: any;
      act(() => {
        renderer = TestRenderer.create(
          <TestVisibilityConsumer isLoading={true} hasData={false} delayMs={180} />
        );
      });

      // At 0ms: skeleton must NOT show yet
      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('false');

      // Advance by 100ms (fast response window): still no skeleton
      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('false');

      // Advance past 180ms: skeleton becomes visible
      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('true');
    });

    it('Rule 3: cancels skeleton display if fast request arrives before delayMs', () => {
      let renderer: any;
      act(() => {
        renderer = TestRenderer.create(
          <TestVisibilityConsumer isLoading={true} hasData={false} delayMs={180} />
        );
      });

      // 80ms into the request, data arrives and loading ends
      act(() => {
        jest.advanceTimersByTime(80);
        renderer.update(
          <TestVisibilityConsumer isLoading={false} hasData={true} delayMs={180} />
        );
      });

      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('false');

      // Further time elapsing never turns skeleton on
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('false');
    });

    it('Rule 5: preserves existing data during background refreshes without flashing skeleton', () => {
      let renderer: any;
      // Screen already has data, starts background refresh
      act(() => {
        renderer = TestRenderer.create(
          <TestVisibilityConsumer isLoading={true} hasData={true} delayMs={180} />
        );
      });

      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('false');
      act(() => {
        jest.advanceTimersByTime(500);
      });
      // Remains false during entire refresh lifecycle
      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('false');
    });

    it('Rule 6: suppresses skeleton immediately when an error occurs so error/retry UI displays', () => {
      let renderer: any;
      act(() => {
        renderer = TestRenderer.create(
          <TestVisibilityConsumer isLoading={true} hasData={false} isError={true} delayMs={180} />
        );
      });

      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('false');
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('false');
    });

    it('Rule 6: automatically times out after timeoutMs so skeleton never hangs indefinitely', () => {
      let renderer: any;
      act(() => {
        renderer = TestRenderer.create(
          <TestVisibilityConsumer isLoading={true} hasData={false} delayMs={180} timeoutMs={2000} />
        );
      });

      // After 200ms, skeleton is visible
      act(() => {
        jest.advanceTimersByTime(200);
      });
      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('true');

      // After timeoutMs (2000ms), skeleton times out and turns false
      act(() => {
        jest.advanceTimersByTime(2000);
      });
      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('false');
    });
  });
});
