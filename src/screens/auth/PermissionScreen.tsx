import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { strings } from '../../data/mockData';
import Button from '../../components/atoms/Button';

export interface PermissionScreenProps {
  readonly variant: 'location' | 'notification' | 'camera';
  readonly onAllow?: () => void;
  readonly onNotNow?: () => void;
}

const iconMap = {
  location: '📍',
  notification: '🔔',
  camera: '📷',
} as const;

const titleMap = {
  location: 'Enable Location',
  notification: 'Enable Notifications',
  camera: 'Allow Camera Access',
} as const;

const subtitleMap = {
  location: 'We need your location to find nearby drivers and show accurate pickup points.',
  notification: 'Stay updated on your delivery status and driver arrival.',
  camera: 'Take photos for delivery verification and proof of pickup.',
} as const;

const PermissionScreen: React.FC<PermissionScreenProps & { navigation?: any }> = ({
  variant,
  onAllow,
  onNotNow,
  navigation,
}) => {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.iconWrapper}>
          <View style={styles.iconCircle}>
            <Text style={styles.icon}>{iconMap[variant]}</Text>
          </View>
        </View>
        <Text style={styles.title}>{titleMap[variant]}</Text>
        <Text style={styles.subtitle}>{subtitleMap[variant]}</Text>
      </View>

      <View style={styles.footer}>
        <Button
          label={strings.permissions.allow}
          onPress={() => {
            onAllow?.();
            navigation?.navigate('RecordingConsentScreen');
          }}
          variant="primary"
          size="lg"
          fullWidth
        />
        <Button
          label={strings.permissions.notNow}
          onPress={() => {
            onNotNow?.();
            navigation?.navigate('RecordingConsentScreen');
          }}
          variant="ghost"
          size="lg"
          fullWidth
        />
      </View>
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
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxxl,
    gap: spacing.lg,
  },
  iconWrapper: {
    marginBottom: spacing.xl,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primaryFixed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 44,
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    lineHeight: typography.headlineMd.lineHeight,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyLg.fontFamily,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: spacing.marginMobile,
    paddingBottom: spacing.xxxl,
    gap: spacing.sm,
  },
});

export default PermissionScreen;
