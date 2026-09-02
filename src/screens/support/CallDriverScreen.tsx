import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import Button from '../../components/atoms/Button';

export interface CallDriverScreenProps {
  readonly driverName?: string;
  readonly vehicleInfo?: string;
  readonly pickupLocation?: string;
  readonly onEndCall?: () => void;
  readonly onBack?: () => void;
}

const CallDriverScreen: React.FC<CallDriverScreenProps & { navigation?: any }> = ({
  driverName = 'Ramesh Kumar',
  vehicleInfo = 'Tata Ace • RJ 19 XX 1234',
  pickupLocation = 'Sardarpura Warehouse',
  onEndCall,
  onBack,
  navigation,
}) => {
  const ripple1 = useRef(new Animated.Value(0)).current;
  const ripple2 = useRef(new Animated.Value(0)).current;
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);

  useEffect(() => {
    const createRipple = (anim: Animated.Value, delay: number) => {
      return Animated.sequence([
        Animated.delay(delay),
        Animated.loop(
          Animated.parallel([
            Animated.timing(anim, {
              toValue: 1,
              duration: 2000,
              easing: Easing.linear,
              useNativeDriver: true,
            }),
          ])
        ),
      ]);
    };

    createRipple(ripple1, 0).start();
    createRipple(ripple2, 500).start();
  }, [ripple1, ripple2]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* App Bar */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
        >
          <Feather name="arrow-left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Pick Up</Text>
        <View style={styles.iconButton} />
      </View>

      <View style={styles.mainContent}>
        {/* Top Context */}
        <View style={styles.topContext}>
          <Text style={styles.callingText}>Calling...</Text>
          <Text style={styles.driverName}>{driverName}</Text>
          
          <View style={styles.avatarContainer}>
            <Animated.View
              style={[
                styles.ripple,
                {
                  transform: [
                    {
                      scale: ripple1.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 2],
                      }),
                    },
                  ],
                  opacity: ripple1.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.4, 0],
                  }),
                },
              ]}
            />
            <Animated.View
              style={[
                styles.ripple,
                {
                  transform: [
                    {
                      scale: ripple2.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 2],
                      }),
                    },
                  ],
                  opacity: ripple2.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.4, 0],
                  }),
                },
              ]}
            />
            
            <View style={styles.avatarInner}>
              <Feather name="user" size={48} color={colors.onSurfaceVariant} />
            </View>
            
            <View style={styles.ratingBadge}>
              <MaterialIcons name="star" size={12} color={colors.primary} />
              <Text style={styles.ratingText}>4.8</Text>
            </View>
          </View>
        </View>

        {/* Vehicle & Trip Context Cards */}
        <View style={styles.contextCards}>
          <View style={styles.contextCard}>
            <View style={styles.contextIconBox}>
              <MaterialIcons name="local-shipping" size={20} color={colors.onSurfaceVariant} />
            </View>
            <View style={styles.contextTextContainer}>
              <Text style={styles.contextLabel}>VEHICLE</Text>
              <Text style={styles.contextValue}>{vehicleInfo}</Text>
            </View>
          </View>

          <View style={styles.contextCard}>
            <View style={styles.contextIconBox}>
              <MaterialIcons name="location-on" size={20} color={colors.onSurfaceVariant} />
            </View>
            <View style={styles.contextTextContainer}>
              <Text style={styles.contextLabel}>PICKUP LOCATION</Text>
              <Text style={styles.contextValue}>{pickupLocation}</Text>
            </View>
          </View>
        </View>

        {/* Bottom Controls */}
        <View style={styles.bottomControls}>
          {/* Privacy Note */}
          <View style={styles.privacyNote}>
            <MaterialIcons name="security" size={20} color={colors.primary} style={styles.privacyIcon} />
            <Text style={styles.privacyText}>
              Your personal number is hidden. This call is routed through Pick Up for your privacy and security.
            </Text>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionsContainer}>
            <View style={styles.secondaryActions}>
              <Pressable
                style={styles.callControlBtn}
                onPress={() => setIsMuted((prev) => !prev)}
                accessibilityRole="switch"
                accessibilityLabel="Mute"
                accessibilityState={{ checked: isMuted }}
              >
                <View style={styles.callControlIconBox}>
                  <Feather name="mic-off" size={24} color={colors.onSurfaceVariant} />
                </View>
                <Text style={styles.callControlLabel}>Mute</Text>
              </Pressable>
              
              <View style={styles.callControlBtn}>
                <View style={styles.callControlIconBox}>
                  <Feather name="grid" size={24} color={colors.onSurfaceVariant} />
                </View>
                <Text style={styles.callControlLabel}>Keypad</Text>
              </View>
              
              <Pressable
                style={styles.callControlBtn}
                onPress={() => setIsSpeakerOn((prev) => !prev)}
                accessibilityRole="switch"
                accessibilityLabel="Speaker"
                accessibilityState={{ checked: isSpeakerOn }}
              >
                <View style={styles.callControlIconBox}>
                  <Feather name="volume-2" size={24} color={colors.onSurfaceVariant} />
                </View>
                <Text style={styles.callControlLabel}>Speaker</Text>
              </Pressable>
            </View>

            <Pressable
              style={styles.endCallBtn}
              onPress={() => (onEndCall ? onEndCall() : navigation?.goBack())}
            >
              <MaterialIcons name="call-end" size={24} color={colors.onErrorContainer} />
              <Text style={styles.endCallText}>End Call</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
    textAlign: 'center',
  },
  mainContent: {
    flex: 1,
    paddingHorizontal: spacing.marginMobile,
    justifyContent: 'space-between',
  },
  topContext: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  callingText: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: 4,
  },
  driverName: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  avatarContainer: {
    position: 'relative',
    width: 128,
    height: 128,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.xxl,
  },
  ripple: {
    position: 'absolute',
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: colors.primaryContainer,
  },
  avatarInner: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surfaceContainer,
    borderWidth: 4,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  ratingBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    borderRadius: borderRadius.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
    zIndex: 20,
  },
  ratingText: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.labelCaps.fontFamily,
  },
  contextCards: {
    gap: spacing.sm,
  },
  contextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
  contextIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contextTextContainer: {
    flex: 1,
  },
  contextLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    letterSpacing: typography.labelSm.letterSpacing,
    textTransform: 'uppercase',
  },
  contextValue: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  bottomControls: {
    gap: spacing.xl,
    marginBottom: spacing.xl,
  },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.primaryFixed + '4D', // 30% opacity
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.primaryFixedDim + '80', // 50% opacity
  },
  privacyIcon: {
    marginTop: 2,
  },
  privacyText: {
    flex: 1,
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant, // fallback from on-primary-fixed-variant
    fontFamily: typography.labelSm.fontFamily,
    lineHeight: 20,
  },
  actionsContainer: {
    gap: spacing.xxl,
  },
  secondaryActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xxl,
  },
  callControlBtn: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  callControlIconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callControlLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  endCallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.errorContainer,
    borderRadius: borderRadius.full,
    height: 64,
  },
  endCallText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onErrorContainer,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default CallDriverScreen;
