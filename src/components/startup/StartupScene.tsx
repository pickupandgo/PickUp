import React from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Stop,
} from 'react-native-svg';
import { colors } from '../../theme';
import { interval, POSE_STARTS, poseOpacity, sceneAt } from './startupTimeline';

const blendCels =
  Platform.OS === 'ios' ||
  (Platform.OS === 'android' && Number(Platform.Version) >= 29);

export const startupArtwork = [
  require('../../../assets/startup/01-arrive.png'),
  require('../../../assets/startup/02-reach.png'),
  require('../../../assets/startup/03-lift.png'),
  require('../../../assets/startup/04-secure.png'),
  require('../../../assets/startup/05-ride.png'),
  require('../../../assets/startup/06-deliver.png'),
];
const officialLogo = require('../../../assets/branding/multipleride-partner-logo-transparent.png');

function Parcel() {
  return (
    <Svg width={54} height={54} viewBox="0 0 60 60">
      <Defs>
        <LinearGradient id="boxFace" x2="1" y2="1">
          <Stop stopColor={colors.startupParcel} />
          <Stop offset="1" stopColor={colors.startupParcelShade} />
        </LinearGradient>
      </Defs>
      <Path d="M6 15 39 8 56 18 23 26Z" fill={colors.startupParcelLight} />
      <Path d="M6 15 23 26V54L6 41Z" fill={colors.startupParcelShade} />
      <Path d="M23 26 56 18V45L23 54Z" fill="url(#boxFace)" />
      <Path d="M22 12 29 10 46 20 39 22Z" fill={colors.startupBlue} />
      <Path d="M39 22 46 20V48L39 50Z" fill={colors.startupBlueDark} />
    </Svg>
  );
}

function Destination() {
  return (
    <Svg width={90} height={178} viewBox="0 0 90 178">
      <Defs>
        <LinearGradient id="house" x2="1" y2="1">
          <Stop stopColor={colors.startupArchitecture} />
          <Stop offset="1" stopColor={colors.startupArchitectureShade} />
        </LinearGradient>
        <LinearGradient id="door" x2="0" y2="1">
          <Stop stopColor={colors.startupBlueDark} />
          <Stop offset="1" stopColor={colors.startupBlueDeep} />
        </LinearGradient>
      </Defs>
      <Ellipse
        cx="46"
        cy="166"
        rx="43"
        ry="9"
        fill={colors.startupShadow}
        opacity="0.18"
      />
      <Path d="M8 39 66 25 83 36V156L24 172 8 160Z" fill="url(#house)" />
      <Path
        d="M66 25 83 36V156L66 149Z"
        fill={colors.startupArchitectureShade}
      />
      <Path d="M8 39 66 25 83 36 24 51Z" fill={colors.onPrimary} />
      <Path d="M26 85 59 77V157L26 166Z" fill="url(#door)" />
      <Path
        d="M26 85 59 77V87L26 95Z"
        fill={colors.startupBlueLight}
        opacity="0.4"
      />
      <Circle cx="51" cy="123" r="2.3" fill={colors.onPrimary} />
      <Path
        d="M18 164 65 151 73 158 25 173Z"
        fill={colors.startupArchitecture}
      />
    </Svg>
  );
}

function Pose({
  index,
  time,
  onAssetReady,
}: {
  index: number;
  time: SharedValue<number>;
  onAssetReady: (id: number, failed?: boolean) => void;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: blendCels
      ? poseOpacity(time.value, index)
      : time.value >= POSE_STARTS[index] &&
        (POSE_STARTS[index + 1] === undefined ||
          time.value < POSE_STARTS[index + 1])
      ? 1
      : 0,
  }));
  return (
    <Animated.Image
      source={startupArtwork[index]}
      resizeMode="contain"
      fadeDuration={0}
      accessible={false}
      style={[styles.pose, style]}
      onLoad={() => onAssetReady(index)}
      onError={() => onAssetReady(index, true)}
    />
  );
}

function RollingWheel({
  time,
  left,
}: {
  time: SharedValue<number>;
  left: number;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${sceneAt(time.value).wheelAngle}deg` }],
    opacity:
      time.value < 620 || (time.value > 1300 && time.value < 1920) ? 0.6 : 0,
  }));
  return (
    <Animated.View
      style={[
        { position: 'absolute', left, top: 231, width: 40, height: 40 },
        style,
      ]}
    >
      <Svg width={40} height={40} viewBox="0 0 50 50">
        <G
          stroke={colors.startupWheelHighlight}
          strokeWidth="1.2"
          opacity="0.7"
        >
          {[0, 60, 120, 180, 240, 300].map(angle => (
            <Path
              key={angle}
              d="M25 8V18"
              transform={`rotate(${angle} 25 25)`}
            />
          ))}
        </G>
      </Svg>
    </Animated.View>
  );
}

export function StartupScene({
  time,
  onAssetReady,
  staticBrand = false,
}: {
  time: SharedValue<number>;
  onAssetReady: (id: number, failed?: boolean) => void;
  staticBrand?: boolean;
}) {
  const bike = useAnimatedStyle(() => {
    const s = sceneAt(time.value);
    return {
      transform: [
        { translateX: s.bikeX },
        { translateY: s.bikeY },
        { rotate: `${s.lean}deg` },
      ],
    };
  });
  const shadow = useAnimatedStyle(() => ({
    opacity: interval(time.value, 120, 450) * 0.25,
    transform: [
      { translateX: sceneAt(time.value).bikeX },
      { scaleX: 1 - sceneAt(time.value).bikeY * 0.005 },
    ],
  }));
  const road = useAnimatedStyle(() => ({
    transform: [{ translateX: sceneAt(time.value).roadX }],
  }));
  const destination = useAnimatedStyle(() => ({
    opacity: sceneAt(time.value).destination,
    transform: [{ translateX: (1 - sceneAt(time.value).destination) * 100 }],
  }));
  const parcel = useAnimatedStyle(() => {
    const s = sceneAt(time.value);
    return {
      opacity: s.parcelOpacity,
      transform: [
        { translateX: s.parcelX },
        { translateY: s.parcelY },
        { scale: s.parcelScale },
        { rotate: `${-8 * Math.sin(s.delivery * Math.PI)}deg` },
      ],
    };
  });
  const completion = useAnimatedStyle(() => ({
    opacity: sceneAt(time.value).completion,
    transform: [{ scale: 0.7 + sceneAt(time.value).completion * 0.3 }],
  }));
  const brand = useAnimatedStyle(() => ({
    opacity: staticBrand ? 1 : sceneAt(time.value).brand,
    transform: [
      { translateY: staticBrand ? 0 : (1 - sceneAt(time.value).brand) * 12 },
    ],
  }));

  return (
    <View style={styles.stage} testID="startup-scene" accessible={false}>
      {!staticBrand && (
        <>
          <Svg
            style={StyleSheet.absoluteFill}
            width={390}
            height={460}
            viewBox="0 0 390 460"
          >
            <Ellipse
              cx="203"
              cy="320"
              rx="193"
              ry="142"
              fill={colors.startupBlueLight}
              opacity="0.13"
            />
            <Ellipse
              cx="201"
              cy="413"
              rx="216"
              ry="38"
              fill={colors.startupBlueDeep}
              opacity="0.13"
            />
            <Path
              d="M-55 420 358 367 455 406 42 460Z"
              fill={colors.startupBlueDeep}
              opacity="0.19"
            />
          </Svg>
          <Animated.View style={[styles.destination, destination]}>
            <Destination />
          </Animated.View>
          <View style={styles.roadClip}>
            <Animated.View style={[styles.roadLines, road]}>
              {[0, 1, 2, 3, 4, 5, 6, 7].map(n => (
                <View key={n} style={styles.roadLine} />
              ))}
            </Animated.View>
          </View>
          <Animated.View style={[styles.shadow, shadow]} />
      <Animated.View collapsable={false} renderToHardwareTextureAndroid needsOffscreenAlphaCompositing style={[styles.bike, bike]}>
            {startupArtwork.map((_, index) => (
              <Pose
                key={index}
                index={index}
                time={time}
                onAssetReady={onAssetReady}
              />
            ))}
            <RollingWheel time={time} left={237.5} />
            <RollingWheel time={time} left={57.5} />
          </Animated.View>
          <Animated.View style={[styles.parcel, parcel]}>
            <Parcel />
          </Animated.View>
          <Animated.View style={[styles.complete, completion]}>
            <Svg width={37} height={37} viewBox="0 0 40 40">
              <Circle cx="20" cy="20" r="18" fill={colors.onPrimary} />
              <Path
                d="m12 20 5 5 11-12"
                fill="none"
                stroke={colors.startupBlueDark}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Animated.View>
        </>
      )}
      <Animated.View
        style={[styles.lockup, staticBrand && styles.staticLockup, brand]}
      >
        <Image
          source={officialLogo}
          resizeMode="contain"
          fadeDuration={0}
          style={styles.logo}
          onLoad={() => onAssetReady(6)}
          onError={() => onAssetReady(6, true)}
          accessible={false}
        />
        <Text style={styles.brand}>MultipleRide Partner</Text>
      </Animated.View>
    </View>
  );
}

export function NativeLaunchMatch({ time }: { time: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    opacity: sceneAt(time.value).initialBrand,
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.nativeMatch, style]}>
      <Image
        source={officialLogo}
        style={styles.nativeLogo}
        resizeMode="contain"
        fadeDuration={0}
        accessible={false}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: { width: 390, height: 460 },
  destination: { position: 'absolute', left: 298, top: 239 },
  bike: {
    position: 'absolute',
    left: 35,
    top: 130,
    width: 320,
    height: 320,
    isolation: 'isolate',
  },
  // Add premultiplied cel colors inside an isolated transparent layer. Ordinary
  // over-blending would make two half-opacity opaque poses only 75% opaque,
  // exposing the road through the character during the hand movement.
  pose: {
    position: 'absolute',
    width: 320,
    height: 320,
    mixBlendMode: blendCels ? 'plus-lighter' : 'normal',
  },
  shadow: {
    position: 'absolute',
    left: 55,
    top: 408,
    width: 280,
    height: 19,
    borderRadius: 140,
    backgroundColor: colors.startupShadow,
  },
  roadClip: {
    position: 'absolute',
    left: 0,
    top: 427,
    width: 390,
    height: 8,
    overflow: 'hidden',
  },
  roadLines: { flexDirection: 'row', width: 608, gap: 42 },
  roadLine: {
    width: 34,
    height: 3,
    backgroundColor: colors.onPrimary,
    opacity: 0.23,
    borderRadius: 2,
  },
  parcel: { position: 'absolute', left: 0, top: 0, width: 54, height: 54 },
  complete: { position: 'absolute', left: 326, top: 313 },
  lockup: { position: 'absolute', top: 0, width: 390, alignItems: 'center' },
  staticLockup: { top: 135 },
  logo: { width: 96, height: 96 },
  brand: {
    color: colors.onPrimary,
    fontSize: 27,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: -0.7,
    marginTop: 15,
  },
  nativeMatch: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nativeLogo: { width: 142, height: 142 },
});

