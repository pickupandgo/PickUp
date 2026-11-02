import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '../../theme';
import { NativeLaunchMatch, StartupScene } from './StartupScene';
import { INTRO_DURATION_MS, stageSize } from './startupTimeline';

/** Navigation mounts immediately underneath. Motion never authenticates anyone
 * or releases an unresolved account gate. This wrapper lives for the JS session,
 * rather than for a route or an AppState activation. */
export function StartupExperience({
  ready,
  children,
}: {
  ready: boolean;
  children: React.ReactNode;
}) {
  const window = useWindowDimensions();
  // Measure this root, rather than assuming the physical display size. This
  // also covers split-screen and Android secondary displays with another DPI.
  const [viewport, setViewport] = useState({
    width: window.width,
    height: window.height,
  });
  const initialReducedMotion = useReducedMotion();
  const [reducedMotion, setReducedMotion] = useState(initialReducedMotion);
  const motionSetting = useRef(initialReducedMotion);
  const [visible, setVisible] = useState(true);
  const [storyDone, setStoryDone] = useState(false);
  const [assetsReady, setAssetsReady] = useState(false);
  const [assetFailed, setAssetFailed] = useState(false);
  const assets = useRef(new Set<number>());
  const started = useRef(false);
  const finishing = useRef(false);
  const time = useSharedValue(0);
  const opacity = useSharedValue(1);
  const geometry = stageSize(viewport.width, viewport.height);
  const finishStory = useCallback(() => setStoryDone(true), []);
  const dismiss = useCallback(() => setVisible(false), []);
  const updateMotion = useCallback((value: boolean) => {
    if (motionSetting.current === value) return;
    motionSetting.current = value;
    setReducedMotion(value);
  }, []);
  const onAssetReady = useCallback((id: number, failed = false) => {
    assets.current.add(id);
    if (failed) setAssetFailed(true);
    if (assets.current.size === 7) setAssetsReady(true);
  }, []);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => {
        if (alive) updateMotion(value);
      })
      .catch(() => {});
    const motion = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      updateMotion,
    );
    return () => {
      alive = false;
      motion.remove();
    };
  }, [updateMotion]);

  useEffect(() => {
    if (storyDone) return;
    if (reducedMotion || assetFailed) {
      cancelAnimation(time);
      time.value = INTRO_DURATION_MS;
      finishStory();
      return;
    }
    if (!assetsReady || started.current) return;
    started.current = true;
    time.value = withTiming(
      INTRO_DURATION_MS,
      {
        duration: INTRO_DURATION_MS,
        easing: Easing.linear,
        reduceMotion: ReduceMotion.Never,
      },
      finished => {
        if (finished) runOnJS(finishStory)();
      },
    );
  }, [assetsReady, reducedMotion, assetFailed, time, finishStory, storyDone]);

  useEffect(() => {
    // Maximum bound for lost image/animation callbacks, never a minimum delay.
    if (storyDone) return;
    const watchdog = setTimeout(() => {
      cancelAnimation(time);
      time.value = INTRO_DURATION_MS;
      finishStory();
    }, INTRO_DURATION_MS + 700);
    const background = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        cancelAnimation(time);
        time.value = INTRO_DURATION_MS;
        finishStory();
      }
    });
    return () => {
      clearTimeout(watchdog);
      background.remove();
      cancelAnimation(time);
    };
  }, [time, finishStory, storyDone]);

  useEffect(
    () => () => {
      cancelAnimation(time);
      cancelAnimation(opacity);
    },
    [time, opacity],
  );

  useEffect(() => {
    if (!ready || !storyDone || finishing.current) return;
    finishing.current = true;
    opacity.value = withTiming(
      0,
      {
        duration: reducedMotion || assetFailed ? 0 : 160,
        reduceMotion: ReduceMotion.System,
      },
      finished => {
        if (finished) runOnJS(dismiss)();
      },
    );
  }, [ready, storyDone, reducedMotion, assetFailed, opacity, dismiss]);

  const overlay = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <View
      style={styles.container}
      testID="startup-root"
      onLayout={({ nativeEvent: { layout } }) => {
        if (layout.width <= 0 || layout.height <= 0) return;
        setViewport(current =>
          current.width === layout.width && current.height === layout.height
            ? current
            : { width: layout.width, height: layout.height },
        );
      }}
    >
      <View
        style={styles.content}
        accessibilityElementsHidden={visible}
        importantForAccessibility={visible ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {visible && (
        <Animated.View
          style={[styles.overlay, overlay]}
          testID="startup-overlay"
          accessibilityViewIsModal
          accessibilityLabel="MultipleRide Partner is starting"
        >
          <StatusBar barStyle="light-content" />
          <View
            style={{
              width: 390 * geometry.scale,
              height: 460 * geometry.scale,
            }}
          >
            <View
              style={{
                width: 390,
                height: 460,
                transform: [
                  { translateX: (390 * geometry.scale - 390) / 2 },
                  { translateY: (460 * geometry.scale - 460) / 2 },
                  { scale: geometry.scale },
                ],
              }}
            >
              <StartupScene
                time={time}
                onAssetReady={onAssetReady}
                staticBrand={reducedMotion || assetFailed}
              />
            </View>
          </View>
          {!reducedMotion && !assetFailed && <NativeLaunchMatch time={time} />}
          {storyDone && !ready && (
            <Text style={styles.waiting} accessibilityLiveRegion="polite">
              Getting your account ready…
            </Text>
          )}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.startupBlue },
  content: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.startupBlue,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  waiting: {
    position: 'absolute',
    bottom: '13%',
    color: colors.onPrimary,
    fontSize: 14,
    opacity: 0.85,
  },
});

