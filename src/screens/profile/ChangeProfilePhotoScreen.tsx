import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { useI18n } from '../../i18n';

export interface ChangeProfilePhotoScreenProps {
  readonly onClose?: () => void;
}

const ChangeProfilePhotoScreen: React.FC<ChangeProfilePhotoScreenProps & { navigation?: any }> = ({
  onClose,
  navigation,
}) => {
  const { t } = useI18n();

  return (
    <View style={styles.container}>
      {/* Scrim Overlay */}
      <Pressable
        style={styles.scrim}
        onPress={() => navigation?.goBack()}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
      />

      {/* Bottom Sheet */}
      <View style={styles.bottomSheet}>
        {/* Drag Handle */}
        <View style={styles.handleContainer}>
          <View style={styles.handle} />
        </View>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{t('profile.changePhoto')}</Text>
          <Text style={styles.subtitle}>{t('profile.changePhotoSubtitle')}</Text>
        </View>

        {/* Action List */}
        <View style={styles.actionList}>
          {/* Take Photo */}
          <Pressable
            style={styles.actionRow}
            onPress={() => navigation?.goBack()}
            accessibilityRole="button"
            accessibilityLabel={t('profile.takePhoto')}
          >
            <Feather name="camera" size={22} color={colors.onSurfaceVariant} />
            <Text style={styles.actionText}>{t('profile.takePhoto')}</Text>
          </Pressable>

          <View style={styles.divider} />

          {/* Choose from Gallery */}
          <Pressable
            style={styles.actionRow}
            onPress={() => navigation?.goBack()}
            accessibilityRole="button"
            accessibilityLabel={t('profile.chooseFromGallery')}
          >
            <Feather name="image" size={22} color={colors.onSurfaceVariant} />
            <Text style={styles.actionText}>{t('profile.chooseFromGallery')}</Text>
          </Pressable>

          <View style={styles.divider} />

          {/* Remove Photo */}
          <Pressable
            style={styles.actionRow}
            onPress={() => navigation?.goBack()}
            accessibilityRole="button"
            accessibilityLabel={t('profile.removePhoto')}
          >
            <Feather name="trash-2" size={22} color={colors.error} />
            <Text style={styles.actionTextDanger}>{t('profile.removePhoto')}</Text>
          </Pressable>
        </View>

        {/* Cancel Button */}
        <SafeAreaView edges={['bottom']} style={styles.cancelContainer}>
          <Pressable
            style={styles.cancelButton}
            onPress={() => navigation?.goBack()}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
          >
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  bottomSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xxl,
    borderTopRightRadius: borderRadius.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  handleContainer: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  handle: {
    width: 48,
    height: 4,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceVariant,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: spacing.marginMobile,
    marginBottom: spacing.xxl,
    gap: spacing.xs,
  },
  title: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    lineHeight: typography.headlineSm.lineHeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  subtitle: {
    fontSize: typography.bodyMd.fontSize,
    lineHeight: typography.bodyMd.lineHeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  actionList: {
    width: '100%',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.marginMobile,
    height: 56,
    gap: spacing.lg,
  },
  actionText: {
    fontSize: typography.bodyMd.fontSize,
    lineHeight: typography.bodyMd.lineHeight,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
    flex: 1,
  },
  actionTextDanger: {
    fontSize: typography.bodyMd.fontSize,
    lineHeight: typography.bodyMd.lineHeight,
    color: colors.error,
    fontFamily: typography.bodyMd.fontFamily,
    flex: 1,
  },
  divider: {
    height: 1,
    backgroundColor: colors.surfaceVariant,
    marginLeft: 56,
    opacity: 0.5,
  },
  cancelContainer: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.xxl,
  },
  cancelButton: {
    height: spacing.rowHeightStandard,
    backgroundColor: colors.secondaryContainer,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSecondaryContainer,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default ChangeProfilePhotoScreen;
