import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import Button from '../../components/atoms/Button';

export interface SearchingDriverScreenProps {
  readonly onCancel?: () => void;
  readonly onMenu?: () => void;
}

const SearchingDriverScreen: React.FC<SearchingDriverScreenProps & { navigation?: any }> = ({
  onCancel,
  onMenu,
  navigation,
}) => {
  const pulse1 = useRef(new Animated.Value(0)).current;
  const pulse2 = useRef(new Animated.Value(0)).current;
  const spinValue = useRef(new Animated.Value(0)).current;
  const scanValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Pulse rings animation
    const createPulse = (anim: Animated.Value, delay: number) => {
      return Animated.sequence([
        Animated.delay(delay),
        Animated.loop(
          Animated.parallel([
            Animated.timing(anim, {
              toValue: 1,
              duration: 2000,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ])
        ),
      ]);
    };

    createPulse(pulse1, 0).start();
    createPulse(pulse2, 1000).start();

    // Spinner
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 2000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    // Scanning sweep effect
    Animated.loop(
      Animated.timing(scanValue, {
        toValue: 1,
        duration: 2500,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, [pulse1, pulse2, spinValue, scanValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const scanTranslate = scanValue.interpolate({
    inputRange: [0, 1],
    outputRange: [-100, 300], // Move across the container
  });

  return (
    <View style={styles.container}>
      {/* Top App Bar */}
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Pressable
              style={styles.iconButton}
              onPress={() => (onMenu ? onMenu() : navigation?.goBack())}
              accessibilityRole="button"
            >
              <Feather name="menu" size={24} color={colors.primary} />
            </Pressable>
            <Text style={styles.headerTitle}>Pick Up</Text>
          </View>
          <View style={styles.profileIconBox}>
            <Feather name="user" size={16} color={colors.onSurfaceVariant} />
          </View>
        </View>
      </SafeAreaView>

      <View style={styles.mainContent}>
        {/* Map Background Mock */}
        <View style={styles.mapBackground} />
        
        {/* Radar Pulse */}
        <View style={styles.radarContainer} pointerEvents="none">
          <Animated.View
            style={[
              styles.pulseRing,
              {
                transform: [
                  {
                    scale: pulse1.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.5, 4],
                    }),
                  },
                ],
                opacity: pulse1.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.8, 0],
                }),
              },
            ]}
          />
          <Animated.View
            style={[
              styles.pulseRing,
              {
                transform: [
                  {
                    scale: pulse2.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.5, 4],
                    }),
                  },
                ],
                opacity: pulse2.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.8, 0],
                }),
              },
            ]}
          />
          <View style={styles.centerPin}>
            <View style={styles.centerPinInner} />
          </View>
        </View>

        {/* Bottom Floating Card */}
        <SafeAreaView edges={['bottom']} style={styles.bottomCardContainer}>
          <View style={styles.bottomCard}>
            <View style={styles.statusHeader}>
              <Animated.View style={{ transform: [{ rotate: spin }] }}>
                <Feather name="loader" size={24} color={colors.primary} />
              </Animated.View>
              <Text style={styles.statusTitle}>Finding a Driver...</Text>
            </View>

            <View style={styles.scanningList}>
              <Animated.View
                style={[
                  styles.scanSweep,
                  { transform: [{ translateX: scanTranslate }] },
                ]}
              />
              
              <View style={styles.vehicleItem}>
                <MaterialIcons name="directions-car" size={28} color={colors.outline} />
                <Text style={styles.vehicleLabel}>AUTO</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.vehicleItem}>
                <MaterialIcons name="local-taxi" size={28} color={colors.outline} />
                <Text style={styles.vehicleLabel}>CAB</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.vehicleItem}>
                <MaterialIcons name="airport-shuttle" size={28} color={colors.outline} />
                <Text style={styles.vehicleLabel}>VAN</Text>
              </View>
            </View>

            <Button
              label="Cancel"
              onPress={() => (onCancel ? onCancel() : navigation?.navigate('CancellationReasonScreen'))}
              variant="outline"
              fullWidth
            />
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
  },
  headerSafeArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    backgroundColor: colors.surface + 'CC', // 80% opacity
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  profileIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  mainContent: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapBackground: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surfaceContainerHigh,
  },
  radarContainer: {
    position: 'absolute',
    top: '45%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  pulseRing: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary + '33', // 20% opacity
  },
  centerPin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  centerPinInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  bottomCardContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.marginMobile,
    zIndex: 20,
  },
  bottomCard: {
    backgroundColor: colors.surfaceContainerLowest + 'F2', // 95% opacity
    borderRadius: borderRadius.lg,
    padding: spacing.marginMobile,
    gap: spacing.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant + '4D', // 30% opacity
    ...shadows.card,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  scanningList: {
    position: 'relative',
    height: 64,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderWidth: 1,
    borderColor: colors.outlineVariant + '80', // 50% opacity
    overflow: 'hidden',
  },
  scanSweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 100,
    backgroundColor: colors.primary + '1A', // 10% opacity
    zIndex: 10,
  },
  vehicleItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    zIndex: 20,
  },
  vehicleLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.outlineVariant,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  divider: {
    width: 1,
    height: 32,
    backgroundColor: colors.outlineVariant + '4D',
    zIndex: 20,
  },
});

export default SearchingDriverScreen;
