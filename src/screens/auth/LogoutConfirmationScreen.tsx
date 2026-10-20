import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { clearSession } from '../../state/session';
import { useSession } from '../../state/SessionContext';
import { useI18n } from '../../i18n';

const { height: screenHeight } = Dimensions.get('window');

export interface LogoutConfirmationScreenProps {
  readonly onLogoutConfirm?: () => void;
  readonly onCancel?: () => void;
}

const LogoutConfirmationScreen: React.FC<LogoutConfirmationScreenProps & { navigation?: any }> = ({
  onLogoutConfirm,
  onCancel,
  navigation,
}) => {
  const { logout } = useSession();
  const { t } = useI18n();
  return (
    <View style={styles.container}>
      {/* Background (Mockup of Settings) */}
      <View style={styles.backgroundMockup}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <View style={styles.mockHeader}>
            <View style={styles.mockHeaderLeft}>
              <Feather name="menu" size={24} color={colors.primary} />
              <Text style={styles.mockHeaderTitle}>{t('home.appName')}</Text>
            </View>
            <View style={styles.mockAvatar} />
          </View>
          
          <View style={styles.mockContent}>
            <View style={styles.mockCard}>
              {[
                { icon: 'user', title: t('settings.account'), subtitle: t('profile.editProfile') },
                { icon: 'bell', title: t('settings.notifications'), subtitle: t('settings.notifications') },
                { icon: 'shield', title: t('settings.privacy'), subtitle: t('settings.privacy') },
              ].map((item, index) => (
                <View
                  key={index}
                  style={[styles.mockRow, index < 2 && styles.mockRowBorder]}
                >
                  <Feather name={item.icon as any} size={24} color={colors.onSurfaceVariant} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mockRowTitle}>{item.title}</Text>
                    <Text style={styles.mockRowSubtitle}>{item.subtitle}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </SafeAreaView>
      </View>

      {/* Scrim Overlay */}
      <View style={styles.scrimOverlay}>
        <Pressable
          style={styles.scrimPressable}
          onPress={() => (onCancel ? onCancel() : navigation?.goBack())}
        />
        
        {/* Bottom Sheet */}
        <SafeAreaView edges={['bottom']} style={styles.bottomSheetWrapper}>
          <View style={styles.bottomSheet}>
            {/* Handle */}
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>

            <View style={styles.sheetContent}>
              {/* Icon */}
              <View style={styles.iconCircle}>
                <MaterialIcons name="logout" size={32} color={colors.onErrorContainer} />
              </View>

              {/* Text */}
              <Text style={styles.title}>{t('profile.logoutTitle')}</Text>
              <Text style={styles.subtitle}>
                {t('profile.logoutMessage')}
              </Text>

              {/* Actions */}
              <View style={styles.actionsContainer}>
                <Pressable
                  style={styles.logoutButton}
                  onPress={async () => {
                    onLogoutConfirm?.();
                    await clearSession();
                    await logout();
                  }}
                >
                  <Text style={styles.logoutButtonText}>{t('profile.logout')}</Text>
                </Pressable>
                
                <Pressable
                  style={styles.cancelButton}
                  onPress={() => (onCancel ? onCancel() : navigation?.goBack())}
                >
                  <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  
  // Background Mockup (Blurred look simulated with opacity)
  backgroundMockup: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    opacity: 0.5,
  },
  mockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface,
  },
  mockHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  mockHeaderTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  mockAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceVariant,
  },
  mockContent: {
    flex: 1,
    padding: spacing.marginMobile,
  },
  mockCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  mockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  mockRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceVariant,
  },
  mockRowTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  mockRowSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Scrim and Sheet
  scrimOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.tertiary + '66', // 40% opacity
    justifyContent: 'flex-end',
  },
  scrimPressable: {
    flex: 1,
  },
  bottomSheetWrapper: {
    backgroundColor: 'transparent',
    // Using bottom safe area
  },
  bottomSheet: {
    backgroundColor: colors.surfaceContainerLowest,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -8,
    },
    shadowOpacity: 0.1,
    shadowRadius: 32,
    elevation: 20,
  },
  handleContainer: {
    width: '100%',
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  handle: {
    width: 48,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.outlineVariant,
  },
  sheetContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl * 1.5,
    alignItems: 'center',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.errorContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    textAlign: 'center',
    marginBottom: spacing.xl,
    maxWidth: 280,
  },
  actionsContainer: {
    width: '100%',
    gap: spacing.sm,
  },
  logoutButton: {
    height: 56,
    backgroundColor: colors.error,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onError,
    fontFamily: typography.headlineSm.fontFamily,
  },
  cancelButton: {
    height: 56,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default LogoutConfirmationScreen;
