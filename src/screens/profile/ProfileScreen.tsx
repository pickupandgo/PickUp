import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { strings } from '../../data/mockData';
import { useSession } from '../../state/SessionContext';
import { useI18n } from '../../i18n';
import { getAuth } from '@react-native-firebase/auth';
import { getActivePhoneNumber, normalizePhoneNumber } from '../../auth/authService';
import TopAppBar from '../../components/organisms/TopAppBar';
import Card from '../../components/molecules/Card';
import ListRow from '../../components/molecules/ListRow';
import Divider from '../../components/atoms/Divider';

/** Menu rows share one icon treatment so nothing renders in OS emoji colours. */
const MenuIcon: React.FC<{ readonly name: string }> = ({ name }) => (
  <Feather name={name} size={20} color={colors.onSurfaceVariant} />
);

const Chevron = () => (
  <Feather name="chevron-right" size={20} color={colors.outlineVariant} />
);

export interface ProfileScreenProps {
  readonly onBack?: () => void;
  readonly onEditProfile?: () => void;
  readonly onSavedAddresses?: () => void;
  readonly onBookingHistory?: () => void;
  readonly onNotifications?: () => void;
  readonly onSettings?: () => void;
  readonly onLogout?: () => void;
  readonly onNotificationPress?: () => void;
}

const ProfileScreen: React.FC<ProfileScreenProps & { navigation?: any }> = ({
  onBack,
  onEditProfile,
  onSavedAddresses,
  onBookingHistory,
  onNotifications,
  onSettings,
  onLogout,
  onNotificationPress,
  navigation,
}) => {
  const { userProfile } = useSession();
  const { t } = useI18n();
  const currentUser = getAuth().currentUser;

  const displayName = userProfile?.fullName || currentUser?.displayName || t('profile.customerFallback');
  const displayPhone =
    normalizePhoneNumber(userProfile?.phone) ||
    normalizePhoneNumber(currentUser?.phoneNumber) ||
    normalizePhoneNumber(getActivePhoneNumber()) ||
    t('profile.noVerifiedNumber');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopAppBar
        title={t('profile.title')}
        leadingIcon={
          <View style={styles.avatarSmall}>
            <Feather name="user" size={16} color={colors.primary} />
          </View>
        }
        trailingIcon={<Feather name="bell" size={22} color={colors.primary} />}
        onLeadingPress={() => navigation?.navigate('CustomerSettingsScreen')}
        onTrailingPress={() =>
          onNotificationPress ? onNotificationPress() : navigation?.navigate('NotificationCenterScreen')
        }
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatarLarge}>
            <Feather name="user" size={40} color={colors.onSurfaceVariant} />
          </View>
          <Text style={styles.userName}>{displayName}</Text>
          <View style={styles.phoneRow}>
            <Feather name="phone" size={14} color={colors.onSurfaceVariant} />
            <Text style={styles.phoneText}>{displayPhone}</Text>
          </View>
          <Pressable
            style={styles.editButton}
            onPress={() => (onEditProfile ? onEditProfile() : navigation?.navigate('EditProfileScreen'))}
            accessibilityRole="button"
            accessibilityLabel={t('profile.editProfile')}
          >
            <Text style={styles.editButtonText}>
              {t('profile.editProfile')}
            </Text>
          </Pressable>
        </View>

        {/* Menu Card */}
        <Card variant="outlined" padding="none">
          <ListRow
            title={t('profile.savedAddresses')}
            leading={<MenuIcon name="map-pin" />}
            trailing={<Chevron />}
            onPress={() => (onSavedAddresses ? onSavedAddresses() : navigation?.navigate('SavedAddressesScreen'))}
          />
          <Divider />
          <ListRow
            title={t('profile.bookingHistory')}
            leading={<MenuIcon name="clock" />}
            trailing={<Chevron />}
            onPress={() => (onBookingHistory ? onBookingHistory() : navigation?.navigate('TripHistoryScreen'))}
          />
          <Divider />
          <ListRow
            title={t('profile.notifications')}
            leading={<MenuIcon name="bell" />}
            trailing={<Chevron />}
            onPress={() =>
              onNotifications ? onNotifications() : navigation?.navigate('NotificationCenterScreen')
            }
          />
          <Divider />
          <ListRow
            title={t('settings.title')}
            leading={<MenuIcon name="settings" />}
            trailing={<Chevron />}
            onPress={() => (onSettings ? onSettings() : navigation?.navigate('CustomerSettingsScreen'))}
          />
        </Card>

        {/* Logout Button */}
        <Pressable
          style={styles.logoutButton}
          onPress={() => (onLogout ? onLogout() : navigation?.navigate('LogoutConfirmationScreen'))}
          accessibilityRole="button"
          accessibilityLabel={t('profile.logout')}
        >
          <MaterialIcons name="logout" size={20} color={colors.error} />
          <Text style={styles.logoutText}>{t('profile.logout')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  avatarSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.marginMobile,
    gap: spacing.xxl,
    paddingBottom: spacing.xxxl + spacing.xxl,
  },

  // Profile Header
  profileHeader: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.sm,
  },
  avatarLarge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  userName: {
    fontSize: typography.headlineMd.fontSize,
    lineHeight: typography.headlineMd.lineHeight,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  phoneText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  editButton: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.outlineHairline,
    borderRadius: borderRadius.full,
  },
  editButtonText: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Logout
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.errorContainer,
    // Pill, matching every other primary action in the app.
    borderRadius: borderRadius.full,
    paddingVertical: spacing.lg,
  },
  logoutText: {
    fontSize: typography.bodyLg.fontSize,
    fontWeight: '600',
    color: colors.error,
    fontFamily: typography.bodyLg.fontFamily,
  },
});

export default ProfileScreen;
