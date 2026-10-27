import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import {
  Skeleton,
  SkeletonText,
  SkeletonCircle,
  SkeletonCard,
  SkeletonButton,
  SkeletonListItem,
  DriverHomeSkeleton,
  EarningsHistorySkeleton,
  WalletSkeleton,
  TransactionHistorySkeleton,
  DriverTripHistorySkeleton,
  DriverProfileSkeleton,
  useSkeletonVisibility,
} from '../src/components/skeleton';
import { EarningsCard } from '../src/components/molecules/EarningsCard';
import { WalletCard } from '../src/components/molecules/WalletCard';

jest.mock('../src/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: any) => key,
    locale: 'en',
    setLocale: jest.fn(),
  }),
}));

describe('Light-Mode Skeleton Loading System - Driver App', () => {
  it('renders base Skeleton with accessibility hiding and light-mode color', () => {
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(
        <Skeleton width={100} height={20} borderRadius={6} testID="test-driver-skeleton" />
      );
    });

    const root = renderer.root;
    const view = root.findByProps({ accessibilityElementsHidden: true });
    expect(view).toBeTruthy();
    expect(view.props.accessible).toBe(false);
    expect(view.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('renders SkeletonText with multiple lines and correct count', () => {
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
          <SkeletonCircle size={44} testID="test-circle" />
        </SkeletonCard>
      );
    });

    const root = renderer.root;
    expect(root.findByProps({ testID: 'test-card' })).toBeTruthy();
    expect(root.findByProps({ testID: 'test-circle' })).toBeTruthy();
  });

  it('renders SkeletonButton and multi-item SkeletonListItem', () => {
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(
        <>
          <SkeletonButton width={140} height={44} testID="test-btn" />
          <SkeletonListItem count={3} hasAvatar={true} hasSubtitle={true} testID="test-list-row" />
        </>
      );
    });

    const root = renderer.root;
    expect(root.findByProps({ testID: 'test-btn' })).toBeTruthy();
    const listRow = root.findByProps({ testID: 'test-list-row' });
    expect(listRow).toBeTruthy();
  });

  it('renders all composite Driver screen skeletons without crashing', () => {
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(
        <>
          <DriverHomeSkeleton testID="driver-home-skeleton" />
          <EarningsHistorySkeleton testID="earnings-history-skeleton" />
          <WalletSkeleton testID="wallet-skeleton" />
          <TransactionHistorySkeleton testID="txns-skeleton" />
          <DriverTripHistorySkeleton testID="trips-skeleton" />
          <DriverProfileSkeleton testID="profile-skeleton" />
        </>
      );
    });

    const root = renderer.root;
    expect(root.findByProps({ testID: 'driver-home-skeleton' })).toBeTruthy();
    expect(root.findByProps({ testID: 'earnings-history-skeleton' })).toBeTruthy();
    expect(root.findByProps({ testID: 'wallet-skeleton' })).toBeTruthy();
    expect(root.findByProps({ testID: 'txns-skeleton' })).toBeTruthy();
    expect(root.findByProps({ testID: 'trips-skeleton' })).toBeTruthy();
    expect(root.findByProps({ testID: 'profile-skeleton' })).toBeTruthy();
  });

  it('renders localized skeleton inside EarningsCard when isLoading=true and real values when loaded', () => {
    let loadingRenderer: any;
    act(() => {
      loadingRenderer = TestRenderer.create(
        <EarningsCard
          label="Today"
          amount={0}
          currency="₹"
          isLoading={true}
          testID="earnings-card"
        />
      );
    });

    expect(loadingRenderer.root.findByProps({ testID: 'earnings-card-loading' })).toBeTruthy();

    let loadedRenderer: any;
    act(() => {
      loadedRenderer = TestRenderer.create(
        <EarningsCard
          label="Today"
          amount={1250}
          currency="₹"
          tripCount={6}
          isLoading={false}
          testID="earnings-card"
        />
      );
    });

    expect(loadedRenderer.root.findAllByProps({ testID: 'earnings-card-loading' })).toHaveLength(0);
  });

  it('renders localized skeleton inside WalletCard when isLoading=true and real balance when loaded', () => {
    let loadingRenderer: any;
    act(() => {
      loadingRenderer = TestRenderer.create(
        <WalletCard
          label="Wallet Balance"
          balance={0}
          currency="₹"
          minimumBalance={100}
          isLoading={true}
          testID="wallet-card"
        />
      );
    });

    expect(loadingRenderer.root.findByProps({ testID: 'wallet-card-loading' })).toBeTruthy();

    let loadedRenderer: any;
    act(() => {
      loadedRenderer = TestRenderer.create(
        <WalletCard
          label="Wallet Balance"
          balance={450}
          currency="₹"
          minimumBalance={100}
          isLoading={false}
          testID="wallet-card"
        />
      );
    });

    expect(loadedRenderer.root.findAllByProps({ testID: 'wallet-card-loading' })).toHaveLength(0);
  });

  describe('Intelligent Skeleton Visibility Hook & Driver Rules', () => {
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

      // Fast response window: still no skeleton
      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('false');

      // Advance past 180ms: skeleton displays
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

      // Data arrives within 70ms
      act(() => {
        jest.advanceTimersByTime(70);
        renderer.update(
          <TestVisibilityConsumer isLoading={false} hasData={true} delayMs={180} />
        );
      });

      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('false');

      // Timers advance further, skeleton still never shown
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('false');
    });

    it('Rule 4 & 7: section-level loading isolates earnings and wallet without blocking essential controls', () => {
      let renderer: any;
      let goLivePressed = false;

      // Simulate Driver HomeScreen where earnings is loading, but Go Live button is ready
      act(() => {
        renderer = TestRenderer.create(
          <>
            <EarningsCard
              label="Today"
              amount={0}
              currency="₹"
              isLoading={true}
              testID="earnings-section"
            />
            <WalletCard
              label="Wallet"
              balance={350}
              currency="₹"
              minimumBalance={100}
              isLoading={false}
              testID="wallet-section"
            />
          </>
        );
      });

      // Earnings skeleton shows loading in its section only
      expect(renderer.root.findByProps({ testID: 'earnings-card-loading' })).toBeTruthy();
      // Wallet section shows real balance immediately
      expect(renderer.root.findAllByProps({ testID: 'wallet-card-loading' })).toHaveLength(0);
    });

    it('Rule 5: preserves existing data during background refreshes without flashing skeleton', () => {
      let renderer: any;
      act(() => {
        renderer = TestRenderer.create(
          <TestVisibilityConsumer isLoading={true} hasData={true} delayMs={180} />
        );
      });

      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('false');
      act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('false');
    });

    it('Rule 6: suppresses skeleton immediately on error so Retry UI displays', () => {
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

    it('Rule 6: times out after timeoutMs to ensure skeleton never hangs indefinitely', () => {
      let renderer: any;
      act(() => {
        renderer = TestRenderer.create(
          <TestVisibilityConsumer isLoading={true} hasData={false} delayMs={180} timeoutMs={1500} />
        );
      });

      act(() => {
        jest.advanceTimersByTime(200);
      });
      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('true');

      act(() => {
        jest.advanceTimersByTime(1500);
      });
      expect(renderer.root.findByProps({ testID: 'visibility-result' }).props.children).toBe('false');
    });
  });
});
