import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { Feather } from '@expo/vector-icons';

export interface AssignmentFailedScreenProps {
  readonly onClose?: () => void;
  readonly onRetry?: () => void;
  readonly onCancel?: () => void;
}

const AssignmentFailedScreen: React.FC<AssignmentFailedScreenProps & { navigation?: any }> = ({
  onClose,
  onRetry,
  onCancel,
  navigation,
}) => {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onClose ? onClose() : navigation?.goBack())}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Feather name="x" size={24} color={colors.onSurface} />
        </Pressable>
      </View>

      {/* Main Content Area */}
      <View style={styles.content}>
        {/* Icon Container */}
        <View style={styles.iconContainer}>
          <View style={styles.iconInnerRing} />
          <Feather name="alert-circle" size={64} color={colors.error} style={{ opacity: 0.8 }} />
        </View>

        {/* Text Content */}
        <Text style={styles.title}>Assignment Failed</Text>
        <Text style={styles.subtitle}>
          Something went wrong while connecting with the driver. Your booking has not been charged.
        </Text>
      </View>

      {/* Bottom Action Area */}
      <View style={styles.actionArea}>
        <Pressable
          style={styles.primaryButton}
          onPress={() => (onRetry ? onRetry() : navigation?.navigate('FindingDriverScreen'))}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>Retry Booking</Text>
        </Pressable>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => (onCancel ? onCancel() : navigation?.navigate('HomeScreen'))}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
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

  // Content
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.marginMobile,
    marginTop: -40, // slight offset to balance layout
  },
  iconContainer: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: colors.errorContainer + '4D', // 30% opacity
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.surface,
    marginBottom: spacing.xxl,
    position: 'relative',
  },
  iconInnerRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 64,
    borderWidth: 1,
    borderColor: colors.error + '33', // 20% opacity
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyLg.fontFamily,
    textAlign: 'center',
    maxWidth: 280,
  },

  // Action Area
  actionArea: {
    paddingHorizontal: spacing.marginMobile,
    paddingBottom: spacing.lg,
  },
  primaryButton: {
    width: '100%',
    height: 56,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  secondaryButton: {
    width: '100%',
    height: 56,
    marginTop: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default AssignmentFailedScreen;
