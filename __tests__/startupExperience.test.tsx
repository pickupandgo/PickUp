import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AccessibilityInfo, AppState, Text } from 'react-native';
import { withTiming, useReducedMotion } from 'react-native-reanimated';
import { StartupExperience } from '../src/components/startup/StartupExperience';
import { StartupScene } from '../src/components/startup/StartupScene';
import {
  INTRO_DURATION_MS,
  poseOpacity,
  sceneAt,
  stageSize,
} from '../src/components/startup/startupTimeline';

jest.mock('../src/components/startup/StartupScene', () => ({
  StartupScene: () => null,
  NativeLaunchMatch: () => null,
}));

let renderer: Renderer.ReactTestRenderer;
const timing = jest.mocked(withTiming);
const overlay = () =>
  renderer.root.findAll(node => node.props.testID === 'startup-overlay');
const completeAnimation = async (duration: number) => {
  const call = [...timing.mock.calls]
    .reverse()
    .find(([, config]) => config?.duration === duration);
  expect(call).toBeDefined();
  await act(() => {
    call?.[2]?.(true);
  });
};
const load = async () => {
  await act(() => {
    const callback = renderer.root.findByType(StartupScene).props.onAssetReady;
    for (let n = 0; n < 7; n++) callback(n);
  });
};
const mount = async (ready = true) => {
  await act(() => {
    renderer = Renderer.create(
      <StartupExperience ready={ready}>
        <Text testID="app-content">App mounted</Text>
      </StartupExperience>,
    );
  });
};
beforeEach(() => {
  jest.useFakeTimers();
  renderer = undefined!;
  timing.mockClear();
  jest.mocked(AppState.addEventListener).mockClear();
  jest.mocked(useReducedMotion).mockReturnValue(false);
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(false);
});
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('mounts navigation immediately; story and readiness must both finish before reveal', async () => {
  await mount();
  expect(
    renderer.root.findAll(node => node.props.testID === 'app-content').length,
  ).toBeGreaterThan(0);
  expect(overlay().length).toBeGreaterThan(0);
  expect(timing).not.toHaveBeenCalled();
  await load();
  await completeAnimation(INTRO_DURATION_MS);
  expect(overlay().length).toBeGreaterThan(0);
  await completeAnimation(160);
  expect(overlay()).toHaveLength(0);
});

test('slow session restoration holds the final lockup without looping or exposing content', async () => {
  await mount(false);
  await load();
  await completeAnimation(INTRO_DURATION_MS);
  expect(overlay().length).toBeGreaterThan(0);
  expect(
    renderer.root
      .findAllByType(Text)
      .some(node => node.props.children === 'Getting your account ready…'),
  ).toBe(true);
  expect(
    timing.mock.calls.filter(([, c]) => c?.duration === INTRO_DURATION_MS),
  ).toHaveLength(1);
  await act(() =>
    renderer.update(
      <StartupExperience ready>
        <Text>Signed in destination</Text>
      </StartupExperience>,
    ),
  );
  await completeAnimation(160);
  expect(overlay()).toHaveLength(0);
});

test('reduced motion skips the travel story and adds no fixed startup delay', async () => {
  jest.mocked(useReducedMotion).mockReturnValue(true);
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(true);
  await mount();
  expect(renderer.root.findByType(StartupScene).props.staticBrand).toBe(true);
  expect(
    timing.mock.calls.some(([, c]) => c?.duration === INTRO_DURATION_MS),
  ).toBe(false);
  await completeAnimation(0);
  expect(overlay()).toHaveLength(0);
});

test('a missing asset falls back to the official brand instead of stranding startup', async () => {
  await mount();
  await act(() =>
    renderer.root.findByType(StartupScene).props.onAssetReady(0, true),
  );
  expect(renderer.root.findByType(StartupScene).props.staticBrand).toBe(true);
  await completeAnimation(0);
  expect(overlay()).toHaveLength(0);
});

test('watchdog releases only the animation gate, never an unresolved auth gate', async () => {
  await mount(false);
  await act(() => jest.advanceTimersByTime(INTRO_DURATION_MS + 701));
  expect(overlay().length).toBeGreaterThan(0);
  expect(timing.mock.calls.some(([, c]) => c?.duration === 160)).toBe(false);
});

test('backgrounding settles the story and returning does not replay it', async () => {
  await mount();
  await load();
  const listener = jest
    .mocked(AppState.addEventListener)
    .mock.calls.find(([event]) => event === 'change')![1];
  await act(() => listener('background'));
  await completeAnimation(160);
  await act(() => listener('active'));
  expect(overlay()).toHaveLength(0);
  expect(
    timing.mock.calls.filter(([, c]) => c?.duration === INTRO_DURATION_MS),
  ).toHaveLength(1);
});

test('later account readiness changes cannot remount or replay the intro', async () => {
  await mount();
  await load();
  await completeAnimation(INTRO_DURATION_MS);
  await completeAnimation(160);
  await act(() =>
    renderer.update(
      <StartupExperience ready={false}>
        <Text>Account refresh</Text>
      </StartupExperience>,
    ),
  );
  await act(() =>
    renderer.update(
      <StartupExperience ready>
        <Text>Ready again</Text>
      </StartupExperience>,
    ),
  );
  expect(overlay()).toHaveLength(0);
  expect(
    timing.mock.calls.filter(([, c]) => c?.duration === INTRO_DURATION_MS),
  ).toHaveLength(1);
});

test('uses measured app bounds when a secondary display differs from physical window metrics', async () => {
  await mount(false);
  await act(() =>
    renderer.root
      .findAll(node => node.props.testID === 'startup-root')[0]
      .props.onLayout({ nativeEvent: { layout: { width: 465, height: 291 } } }),
  );
  const stage = renderer.root.findByType(StartupScene).parent!;
  const camera = stage.props.style.transform.find(
    (part: { scale?: number }) => part.scale !== undefined,
  ).scale;
  expect(camera * 460).toBeLessThanOrEqual(291);
  expect(camera * 390).toBeLessThanOrEqual(465);
});

test.each([
  [320, 568],
  [393, 852],
  [800, 1280],
  [1280, 800],
])('complete story fits %ix%i phone/tablet viewport', (width, height) => {
  const s = stageSize(width, height);
  expect(s.width * s.scale).toBeLessThanOrEqual(width - 24);
  expect(s.height * s.scale).toBeLessThanOrEqual(height - 80);
});

test('parcel handling progresses in order, completes delivery and reveals exact final lockup', () => {
  for (const [index, time] of [300, 750, 970, 1170, 1530, 2400].entries()) {
    expect(poseOpacity(time, index)).toBe(1);
  }
  expect(sceneAt(0).bikeX).toBeLessThan(-300);
  expect(sceneAt(1800).bikeX).toBeGreaterThan(sceneAt(1250).bikeX);
  expect(sceneAt(2100).parcelY).toBeLessThan(sceneAt(1980).parcelY);
  expect(sceneAt(INTRO_DURATION_MS).completion).toBe(1);
  expect(sceneAt(INTRO_DURATION_MS).brand).toBe(1);
});

