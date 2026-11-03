import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../../components/atoms/Icon';
import {
  colors,
  typography,
  spacing,
  borderRadius,
} from '../../theme';
import type { AccountScreenProps } from '../../types/navigation';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../../i18n';
import { usePartnerProfile } from '../../hooks/usePartnerProfile';
import { DocumentNavigationCard } from '../../components/documents/DocumentNavigationCard';
import { PartnerAppHeader } from '../../components/molecules/PartnerAppHeader';

export interface ProfileScreenProps {
  readonly navigation: AccountScreenProps<'Profile'>['navigation'];
  readonly testID?: string;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  navigation,
  testID,
}) => {
  const { logout } = useAuth();
  const { t, locale } = useI18n();
  const profile = usePartnerProfile();
  const name = profile.profile?.name || 'Partner';

  const handleLanguage = useCallback(
    () => navigation.navigate('LanguageSelection'),
    [navigation],
  );
  const handleSettings = useCallback(
    () => navigation.navigate('Settings'),
    [navigation],
  );
  const handleNotifications = useCallback(
    () => navigation.navigate('Notifications'),
    [navigation],
  );

  const handleLogout = useCallback(() => {
    Alert.alert(t('profile.logoutTitle'), t('profile.logoutMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.logout'),
        style: 'destructive',
        onPress: logout,
      },
    ]);
  }, [logout, t]);

  const resolvedAvatar = profile.profile?.photoUrl;

  return (
    <SafeAreaView style={styles.safeArea} testID={testID} edges={['top', 'left', 'right']}>
      {/* Top app bar */}
      <PartnerAppHeader onMenu={handleSettings} onNotifications={handleNotifications} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <Pressable
            style={styles.avatarWrap}
            onPress={() => navigation.navigate('EditProfile')}
            accessibilityRole="button"
            accessibilityLabel="Edit profile photo and details"
          >
            {resolvedAvatar ? (
              <Image
                source={{ uri: resolvedAvatar }}
                style={styles.avatarImg}
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Icon name="person" size={44} color={colors.onSurfaceVariant} />
              </View>
            )}
            <View style={styles.avatarEditBadge}>
              <Icon name="edit" size={14} color={colors.onPrimary} />
            </View>
          </Pressable>
          {profile.loading ? <ActivityIndicator accessibilityLabel="Loading profile" color={colors.primary} /> : <Text style={styles.name}>{name}</Text>}
          {profile.error ? <><Text style={styles.profileError} accessibilityRole="alert">{profile.error}</Text><Pressable onPress={profile.refresh} accessibilityRole="button" style={styles.editButton}><Text style={styles.editText}>Retry</Text></Pressable></> : null}
          <Pressable onPress={() => navigation.navigate('EditProfile')} accessibilityRole="button" accessibilityLabel="Edit Profile" style={styles.editButton}><Text style={styles.editText}>Edit Profile</Text><Icon name="edit" size={16} color={colors.startupBlue} /></Pressable>
        </View>


        {/* Documents */}
        <DocumentNavigationCard title="Documents" icon="folder_open" onPress={() => navigation.navigate('DocumentsHub')} />

        {/* Account */}
        <View>
          <Text style={styles.sectionHeading}>{t('profile.account')}</Text>
          <View style={styles.listCard}>
            <Pressable
              style={[styles.row, styles.rowBorder]}
              onPress={handleLanguage}
            >
              <View style={styles.rowLeft}>
                <Icon name="language" size={20} color={colors.outline} />
                <Text style={styles.rowLabel}>{t('profile.language')}</Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={styles.rowValue}>
                  {locale === 'hi'
                    ? t('language.hindi')
                    : t('language.english')}
                </Text>
                <Icon
                  name="chevron_right"
                  size={18}
                  color={colors.onSurfaceVariant}
                />
              </View>
            </Pressable>
            <Pressable
              style={[styles.row, styles.rowBorder]}
              onPress={handleNotifications}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
            >
              <View style={styles.rowLeft}>
                <Icon
                  name="notifications_active"
                  size={20}
                  color={colors.outline}
                />
                <Text style={styles.rowLabel}>
                  {t('profile.notifications')}
                </Text>
              </View>
              <Icon name="chevron_right" size={18} color={colors.outline} />
            </Pressable>
            <Pressable style={styles.row} onPress={handleSettings}>
              <View style={styles.rowLeft}>
                <Icon name="settings" size={20} color={colors.outline} />
                <Text style={styles.rowLabel}>{t('profile.settings')}</Text>
              </View>
              <Icon name="chevron_right" size={18} color={colors.outline} />
            </Pressable>
          </View>
        </View>

        {/* Logout */}
        <Pressable
          style={styles.logoutBtn}
          onPress={handleLogout}
          accessibilityRole="button"
        >
          <Icon name="logout" size={18} color={colors.onSurfaceVariant} />
          <Text style={styles.logoutText}>{t('profile.logout')}</Text>
        </Pressable>
      </ScrollView>
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
    height: 56,
    paddingHorizontal: spacing.containerPadding,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  headerBtn: {
    padding: 4,
  },
  headerTitle: {
    ...typography.headlineMd,
    color: colors.primary,
  },
  scrollContent: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  // Hero
  hero: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  avatarWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    marginBottom: spacing.containerPadding,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainerHighest,
  },
  avatarImg: {
    width: '100%',
    height: '100%',
    borderRadius: 48,
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  name: {
    ...typography.headlineMd,
    color: colors.onSurface,
    textAlign: 'center',
  },
  editButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.containerPadding },
  editText: { ...typography.headlineSm, color: colors.startupBlue },
  profileError: { ...typography.bodyMd, color: colors.error, textAlign: 'center' },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 2,
  },
  locationText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  // Cards
  card: {
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.lg,
    padding: spacing.containerPadding,
    gap: spacing.gutter,
  },
  completionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  completionLabel: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
  },
  completionPct: {
    ...typography.dataMono,
    color: colors.primary,
  },
  progressTrack: {
    height: 4,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceVariant,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  completionHint: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    fontSize: 13,
  },
  // Subscription
  subRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  subLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  subIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryFixed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subPlan: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  subValidity: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    fontSize: 13,
  },
  manageText: {
    ...typography.labelCaps,
    color: colors.primary,
  },
  // Sections / lists
  sectionHeading: {
    ...typography.labelCaps,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.gutter,
    marginLeft: spacing.unit,
  },
  listCard: {
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.containerPadding,
    height: 56,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowLabel: {
    ...typography.bodyMd,
    color: colors.onSurface,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  rowValue: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    fontSize: 13,
  },
  badgeVerified: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceVariant,
  },
  badgeVerifiedText: {
    ...typography.labelCaps,
    color: colors.onSurface,
  },
  badgePending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  badgePendingText: {
    ...typography.labelCaps,
    color: colors.onSurfaceVariant,
  },
  // Logout
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 48,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    marginTop: spacing.xs,
  },
  logoutText: {
    ...typography.labelCaps,
    color: colors.onSurfaceVariant,
  },
});

export default ProfileScreen;
