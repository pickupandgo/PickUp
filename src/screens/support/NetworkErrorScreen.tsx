import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';

export interface NetworkErrorScreenProps {
  readonly onBack?: () => void;
  readonly onMore?: () => void;
  readonly onRetry?: () => void;
  readonly onCheckSettings?: () => void;
}

const NetworkErrorScreen: React.FC<NetworkErrorScreenProps & { navigation?: any }> = ({
  onBack,
  onMore,
  onRetry,
  onCheckSettings,
  navigation,
}) => {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top Navigation */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
        >
          <Feather name="arrow-left" size={24} color={colors.onSurfaceVariant} />
        </Pressable>
        <Text style={styles.headerTitle}>Pick Up</Text>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onMore ? onMore() : navigation?.goBack())}
        >
          <Feather name="more-vertical" size={24} color={colors.onSurfaceVariant} />
        </Pressable>
      </View>

      <View style={styles.content}>
        {/* Decorative Ambient Background Mock */}
        <View style={styles.ambientBackground} />

        <View style={styles.card}>
          <View style={styles.iconContainer}>
            <Feather name="cloud-off" size={48} color={colors.outline} />
          </View>
          
          <Text style={styles.title}>No Internet Connection</Text>
          <Text style={styles.subtitle}>
            Please check your connection and try again.
          </Text>

          <View style={styles.actionContainer}>
            <Pressable
              style={styles.primaryButton}
              onPress={() =>
                onRetry ? onRetry() : navigation?.navigate('CustomerLiveTrackingScreen')
              }
            >
              <Feather name="refresh-cw" size={18} color={colors.onPrimary} />
              <Text style={styles.primaryButtonText}>Retry</Text>
            </Pressable>
            
            <Pressable
              style={styles.secondaryButton}
              onPress={() =>
                onCheckSettings
                  ? onCheckSettings()
                  : navigation?.navigate('RouteUnavailableScreen')
              }
            >
              <Text style={styles.secondaryButtonText}>Check Network Settings</Text>
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
    backgroundColor: colors.background,
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
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    position: 'relative',
  },
  ambientBackground: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: colors.surfaceContainerHigh,
    opacity: 0.4,
    // Note: React Native blur effect requires specialized views or image blur, using a simple circle for ambient effect.
  },
  card: {
    width: '100%',
    maxWidth: 384,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: 40,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest + '80', // 50% opacity
    ...shadows.card,
    zIndex: 10,
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
    // shadow-inner effect approximation
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
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
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    textAlign: 'center',
    marginBottom: 40,
    maxWidth: 260,
    lineHeight: 20, // Approx relaxed
  },
  actionContainer: {
    width: '100%',
    gap: spacing.md,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    ...shadows.card,
  },
  primaryButtonText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.labelSm.fontFamily,
    letterSpacing: typography.labelSm.letterSpacing,
  },
  secondaryButton: {
    height: 48,
    backgroundColor: 'transparent',
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.secondary,
    fontFamily: typography.labelSm.fontFamily,
    letterSpacing: typography.labelSm.letterSpacing,
  },
});

export default NetworkErrorScreen;
