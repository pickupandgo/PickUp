import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { launchImageLibrary } from 'react-native-image-picker';
import Icon from '../../components/atoms/Icon';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import type { AccountScreenProps } from '../../types/navigation';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../../i18n';

export interface ProfileScreenProps {
  readonly navigation: AccountScreenProps<'Profile'>['navigation'];
  readonly testID?: string;
}

const AVATAR_KEY = 'driver.avatarUri';

type DocStatus = 'verified' | 'pending';

interface DocItem {
  readonly key: string;
  readonly labelKey: string;
  readonly icon: string;
  readonly status: DocStatus;
  readonly route: 'KYCDocuments' | 'VehicleDocuments';
}

const DOCUMENTS: readonly DocItem[] = [
  { key: 'aadhaar', labelKey: 'doc.aadhaar', icon: 'badge', status: 'verified', route: 'KYCDocuments' },
  { key: 'dl', labelKey: 'doc.dl', icon: 'contact_mail', status: 'verified', route: 'KYCDocuments' },
  { key: 'rc', labelKey: 'doc.rc', icon: 'directions_car', status: 'pending', route: 'VehicleDocuments' },
];

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ navigation, testID }) => {
  const { driver, logout } = useAuth();
  const { t, locale } = useI18n();
  const [avatarUri, setAvatarUri] = useState<string | undefined>(undefined);

  const name = driver?.name ?? 'Raj Kumar';
  const location = driver?.location ?? 'Jodhpur, RJ';
  const completion = driver?.profileCompletionPercent ?? 85;

  // Restore a previously chosen avatar so it survives app restarts.
  useEffect(() => {
    AsyncStorage.getItem(AVATAR_KEY)
      .then((uri) => {
        if (uri) setAvatarUri(uri);
      })
      .catch(() => {});
  }, []);

  const handlePickAvatar = useCallback(async () => {
    try {
      const result = await launchImageLibrary({ mediaType: 'photo', quality: 0.8, selectionLimit: 1 });
      if (result.didCancel) return;
      const uri = result.assets?.[0]?.uri;
      if (uri) {
        setAvatarUri(uri);
        AsyncStorage.setItem(AVATAR_KEY, uri).catch(() => {});
      }
    } catch {
      Alert.alert('Could not open gallery', 'Please try again.');
    }
  }, []);

  const handleManage = useCallback(() => navigation.navigate('Subscription'), [navigation]);
  const handleLanguage = useCallback(() => navigation.navigate('LanguageSelection'), [navigation]);
  const handleSettings = useCallback(() => navigation.navigate('Settings'), [navigation]);
  const handleNotifications = useCallback(() => navigation.navigate('Settings'), [navigation]);
  const handleDoc = useCallback(
    (route: DocItem['route']) => navigation.navigate(route),
    [navigation],
  );

  const handleLogout = useCallback(() => {
    Alert.alert(t('profile.logoutTitle'), t('profile.logoutMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.logout'), style: 'destructive', onPress: () => void logout() },
    ]);
  }, [logout, t]);

  const resolvedAvatar = avatarUri ?? driver?.avatarUrl;

  return (
    <SafeAreaView style={styles.safeArea} testID={testID} edges={['top']}>
      {/* Top app bar */}
      <View style={styles.header}>
        <Pressable style={styles.headerBtn} onPress={handleSettings}>
          <Icon name="menu" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>PICK UP</Text>
        <Pressable style={styles.headerBtn} onPress={handleNotifications}>
          <Icon name="notifications" size={24} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          <Pressable style={styles.avatarWrap} onPress={handlePickAvatar} accessibilityRole="button">
            {resolvedAvatar ? (
              <Image source={{ uri: resolvedAvatar }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Icon name="person" size={44} color={colors.onSurfaceVariant} />
              </View>
            )}
            <View style={styles.avatarEditBadge}>
              <Icon name="photo_camera" size={14} color={colors.onPrimary} />
            </View>
          </Pressable>
          <Text style={styles.name}>{name}</Text>
          <View style={styles.locationRow}>
            <Icon name="location_on" size={16} color={colors.onSurfaceVariant} />
            <Text style={styles.locationText}>{location}</Text>
          </View>
        </View>

        {/* Profile completion */}
        <View style={styles.card}>
          <View style={styles.completionHeader}>
            <Text style={styles.completionLabel}>{t('profile.completion')}</Text>
            <Text style={styles.completionPct}>{completion}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${completion}%` }]} />
          </View>
          <Text style={styles.completionHint}>{t('profile.completionHint')}</Text>
        </View>

        {/* Subscription */}
        <View style={styles.card}>
          <View style={styles.subRow}>
            <View style={styles.subLeft}>
              <View style={styles.subIcon}>
                <Icon name="workspace_premium" size={20} color={colors.onPrimaryFixed} />
              </View>
              <View>
                <Text style={styles.subPlan}>{t('profile.proPlan')}</Text>
                <Text style={styles.subValidity}>{t('profile.activeUntil')}</Text>
              </View>
            </View>
            <Pressable onPress={handleManage} accessibilityRole="button">
              <Text style={styles.manageText}>{t('profile.manage')}</Text>
            </Pressable>
          </View>
        </View>

        {/* Documents */}
        <View>
          <Text style={styles.sectionHeading}>{t('profile.documents')}</Text>
          <View style={styles.listCard}>
            {DOCUMENTS.map((doc, i) => (
              <Pressable
                key={doc.key}
                style={[styles.row, i < DOCUMENTS.length - 1 && styles.rowBorder]}
                onPress={() => handleDoc(doc.route)}
              >
                <View style={styles.rowLeft}>
                  <Icon name={doc.icon} size={20} color={colors.outline} />
                  <Text style={styles.rowLabel}>{t(doc.labelKey)}</Text>
                </View>
                {doc.status === 'verified' ? (
                  <View style={styles.badgeVerified}>
                    <Icon name="check_circle" size={12} color={colors.onSurface} />
                    <Text style={styles.badgeVerifiedText}>{t('profile.verified')}</Text>
                  </View>
                ) : (
                  <View style={styles.badgePending}>
                    <Icon name="pending" size={12} color={colors.onSurfaceVariant} />
                    <Text style={styles.badgePendingText}>{t('profile.pending')}</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        </View>

        {/* Account */}
        <View>
          <Text style={styles.sectionHeading}>{t('profile.account')}</Text>
          <View style={styles.listCard}>
            <Pressable style={[styles.row, styles.rowBorder]} onPress={handleLanguage}>
              <View style={styles.rowLeft}>
                <Icon name="language" size={20} color={colors.outline} />
                <Text style={styles.rowLabel}>{t('profile.language')}</Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={styles.rowValue}>
                  {locale === 'hi' ? t('language.hindi') : t('language.english')}
                </Text>
                <Icon name="chevron_right" size={18} color={colors.onSurfaceVariant} />
              </View>
            </Pressable>
            <Pressable style={[styles.row, styles.rowBorder]} onPress={handleNotifications}>
              <View style={styles.rowLeft}>
                <Icon name="notifications_active" size={20} color={colors.outline} />
                <Text style={styles.rowLabel}>{t('profile.notifications')}</Text>
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
        <Pressable style={styles.logoutBtn} onPress={handleLogout} accessibilityRole="button">
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
  },
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
