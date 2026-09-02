import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';
import { mockActiveTrip } from '../../data/mockData';

export interface PickupVerifiedSuccessScreenProps {
  readonly onContinue?: () => void;
}

const PickupVerifiedSuccessScreen: React.FC<PickupVerifiedSuccessScreenProps & { navigation?: any }> = ({
  onContinue,
  navigation,
}) => {
  // Success celebration is a moment, not a stop. `replace` (not `navigate`)
  // takes this screen off the stack so the customer can't back-swipe into it
  // once live tracking has begun.
  useEffect(() => {
    const timer = setTimeout(() => {
      onContinue?.();
      navigation?.replace('CustomerLiveTrackingScreen');
    }, 2_500);
    return () => clearTimeout(timer);
  }, [onContinue, navigation]);

  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const cardTranslateY = useRef(new Animated.Value(20)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const buttonTranslateY = useRef(new Animated.Value(20)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(cardTranslateY, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(cardOpacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(buttonTranslateY, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(buttonOpacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [scaleAnim, opacityAnim, cardTranslateY, cardOpacity, buttonTranslateY, buttonOpacity]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.content}>
        
        {/* Success Animation & Main Message */}
        <Animated.View
          style={[
            styles.successHeader,
            { opacity: opacityAnim, transform: [{ scale: scaleAnim }] },
          ]}
        >
          <View style={styles.iconContainer}>
            <Feather name="check-circle" size={48} color={colors.primary} />
          </View>
          <Text style={styles.title}>Pickup verified</Text>
          <Text style={styles.subtitle}>
            The trip has started. Live tracking is now active.
          </Text>
        </Animated.View>

        {/* Trip Details Card */}
        <Animated.View
          style={[
            styles.detailsCard,
            { opacity: cardOpacity, transform: [{ translateY: cardTranslateY }] },
          ]}
        >
          {/* Driver Info */}
          <View style={styles.infoRow}>
            <Image
              source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCB_WlasJu9etU7gAtaAjmRx9SCrDM-Bi5fvnVx6MSDHRuuUbc9sXeOJJDNDeNcy62sLb45xNlJprZezzT8PCegFbLpgWH76m7xuo7yfN72HOyCBVU35IwSVuWJRtrL6rxmPdqQf8YNhi3dMXXkaFbnltrl9xS-na767xJbDpPCDyt7SfnTrk6ZiC7cKpvhdk1RGPQR0UZ-hf-F5VSWk3pfB3lpB3cKUFm2UztczB24tXdjdFhhd1wW' }}
              style={styles.avatarImage}
            />
            <View style={styles.infoTextContainer}>
              <Text style={styles.label}>DRIVER</Text>
              <Text style={styles.valueText}>{mockActiveTrip.driverName}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Vehicle Info */}
          <View style={styles.infoRow}>
            <View style={styles.iconCircle}>
              <Feather name="truck" size={24} color={colors.onSurfaceVariant} />
            </View>
            <View style={styles.infoTextContainer}>
              <Text style={styles.label}>VEHICLE</Text>
              <Text style={styles.dataText}>
                {mockActiveTrip.vehicleType} <Text style={{ color: colors.outlineVariant }}>•</Text> {mockActiveTrip.vehicleNumber}
              </Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Pickup Location Info */}
          <View style={styles.infoRow}>
            <View style={styles.iconCircle}>
              <Feather name="map-pin" size={24} color={colors.onSurfaceVariant} />
            </View>
            <View style={styles.infoTextContainer}>
              <Text style={styles.label}>PICKUP</Text>
              <Text style={styles.valueText}>{mockActiveTrip.stops[0]?.address}</Text>
            </View>
          </View>
        </Animated.View>

      </View>

      {/* Bottom Action Area */}
      <Animated.View
        style={[
          styles.actionArea,
          { opacity: buttonOpacity, transform: [{ translateY: buttonTranslateY }] },
        ]}
      >
        <Pressable
          style={styles.continueButton}
          onPress={() => {
            onContinue?.();
            navigation?.navigate('CustomerLiveTrackingScreen');
          }}
          accessibilityRole="button"
        >
          <Text style={styles.continueButtonText}>TRACK TRIP</Text>
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.marginMobile,
    paddingBottom: spacing.xxl, // leave space for button
  },

  // Success Header
  successHeader: {
    alignItems: 'center',
    marginBottom: spacing.xxxl,
    width: '100%',
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
    borderWidth: 4,
    borderColor: colors.surfaceContainerLowest,
    ...shadows.sm,
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyLg.fontFamily,
    textAlign: 'center',
    maxWidth: 280,
  },

  // Details Card
  detailsCard: {
    width: '100%',
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.sm,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHigh,
    ...shadows.sm,
    gap: spacing.lg,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceVariant,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoTextContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  label: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelCaps.letterSpacing,
    marginBottom: 4,
  },
  valueText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  dataText: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
  },
  divider: {
    height: 1,
    backgroundColor: colors.surfaceVariant,
    opacity: 0.5,
  },

  // Action Area
  actionArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.marginMobile,
    paddingBottom: spacing.xxl, // safe area padding approx
    paddingTop: spacing.lg,
    backgroundColor: colors.background,
  },
  continueButton: {
    width: '100%',
    height: 56,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default PickupVerifiedSuccessScreen;
