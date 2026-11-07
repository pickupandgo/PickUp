import React, { useEffect } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { useSession } from '../../state/SessionContext';
import { getAuth } from '@react-native-firebase/auth';
import { getActivePhoneNumber, normalizePhoneNumber } from '../../auth/authService';
import { ProfileSkeleton, useSkeletonVisibility } from '../../components/skeleton';

export interface ProfileScreenProps {
  readonly onEditProfile?: () => void;
  readonly onSavedAddresses?: () => void;
  readonly onNotifications?: () => void;
  readonly onNotificationPress?: () => void;
  readonly onLogout?: () => void;
  readonly isLoading?: boolean;
}

/** One account hub: identity, useful shortcuts and truthful preferences. */
export default function ProfileScreen({ onEditProfile, onSavedAddresses, onNotifications, onNotificationPress, onLogout, isLoading = false, navigation, route }: ProfileScreenProps & { navigation?: any; route?: any }) {
  const { userProfile, refreshProfile, registrationError } = useSession();
  const currentUser = getAuth().currentUser;
  const showSkeleton = useSkeletonVisibility({ isLoading: Boolean(isLoading || route?.params?.isLoading), hasData: Boolean(userProfile || currentUser?.displayName || currentUser?.phoneNumber) });
  useEffect(() => { refreshProfile?.().catch(() => {}); }, [refreshProfile]);
  useEffect(() => navigation?.addListener?.('focus', () => { refreshProfile?.().catch(() => {}); }), [navigation, refreshProfile]);
  const photo = userProfile?.photoUri || currentUser?.photoURL;
  const name = userProfile?.fullName || currentUser?.displayName || 'Customer';
  const phone = normalizePhoneNumber(userProfile?.phone) || normalizePhoneNumber(currentUser?.phoneNumber) || normalizePhoneNumber(getActivePhoneNumber()) || 'No verified phone';
  const notifications = onNotifications ?? onNotificationPress;
  const menuRow = (title: string, subtitle: string, icon: string, action: () => void, last = false) => <Pressable style={[styles.menuRow, !last && styles.rowBorder]} accessibilityRole="button" accessibilityLabel={title} onPress={action}>
    <View style={styles.menuIcon}><Feather name={icon} size={spacing.xl} color={colors.homeAction} /></View><View style={styles.flex}><Text style={styles.menuTitle}>{title}</Text><Text style={styles.caption}>{subtitle}</Text></View><Feather name="chevron-right" size={spacing.xl} color={colors.secondary} />
  </Pressable>;
  return <SafeAreaView style={styles.page} edges={['top']}>
    <View style={styles.header}><Text style={styles.title}>Profile</Text><Text style={styles.subtitle}>Your account, in one place.</Text></View>
    {showSkeleton ? <ProfileSkeleton testID="profile-skeleton-loading" /> : <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {registrationError && <View style={styles.errorCard}><Text style={styles.errorText} accessibilityRole="alert">{registrationError}</Text><Pressable style={styles.retry} accessibilityRole="button" accessibilityLabel="Refresh profile" onPress={() => void refreshProfile()}><Text style={styles.errorText}>Retry</Text></Pressable></View>}
      <View style={styles.identityCard}>
        <View style={styles.avatar}>{photo ? <Image source={{ uri: photo }} style={styles.avatarImage} resizeMode="cover" /> : <Feather name="user" size={spacing.xxxl} color={colors.homePickup} />}</View>
        <View style={styles.flex}><Text style={styles.name}>{name}</Text><Text style={styles.phone}>{phone}</Text><Pressable style={styles.edit} accessibilityRole="button" accessibilityLabel="Edit Profile" onPress={() => onEditProfile ? onEditProfile() : navigation?.navigate('EditProfileScreen')}><Feather name="edit-2" size={spacing.md} color={colors.homeAction} /><Text style={styles.editText}>Edit profile</Text></Pressable></View>
      </View>
      <View style={styles.section}><Text style={styles.sectionLabel}>YOUR ACCOUNT</Text><View style={styles.menuCard}>
        {menuRow('Saved addresses', 'Manage your pickup and drop locations', 'map-pin', () => onSavedAddresses ? onSavedAddresses() : navigation?.navigate('SavedAddressesScreen'))}
        {menuRow('Notifications', 'Booking updates and messages', 'bell', () => notifications ? notifications() : navigation?.navigate('NotificationCenterScreen'), true)}
      </View></View>
      <Pressable style={styles.logout} accessibilityRole="button" accessibilityLabel="Logout" onPress={() => onLogout ? onLogout() : navigation?.navigate('LogoutConfirmationScreen')}><Feather name="log-out" size={spacing.xl} color={colors.error} /><Text style={styles.logoutText}>Log out</Text></Pressable>
    </ScrollView>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface }, scroll: { flex: 1 }, flex: { flex: 1, minWidth: 0 },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.sm, gap: spacing.xs },
  title: { ...typography.headlineLg, color: colors.homeAction }, subtitle: { ...typography.bodyMd, color: colors.secondary },
  content: { padding: spacing.xl, gap: spacing.xxl, paddingBottom: spacing.xxxl },
  identityCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.selectionOutline, borderRadius: borderRadius.xl, backgroundColor: colors.selectionTint },
  avatar: { width: spacing.rowHeightStandard + spacing.lg, height: spacing.rowHeightStandard + spacing.lg, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: colors.successContainer },
  avatarImage: { width: '100%', height: '100%' }, name: { ...typography.headlineMd, color: colors.homeAction, fontWeight: '700' }, phone: { ...typography.labelSm, color: colors.secondary, marginTop: spacing.xs },
  edit: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: spacing.sm, minHeight: spacing.rowHeightSm, marginTop: spacing.xs }, editText: { ...typography.labelSm, fontWeight: '600', color: colors.homeAction },
  section: { gap: spacing.sm }, sectionLabel: { ...typography.labelCaps, color: colors.secondary },
  menuCard: { borderWidth: 1, borderColor: colors.outlineHairline, borderRadius: borderRadius.xl, overflow: 'hidden', backgroundColor: colors.surface },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, minHeight: spacing.rowHeightStandard + spacing.lg }, rowBorder: { borderBottomWidth: 1, borderColor: colors.outlineHairline },
  menuIcon: { width: spacing.rowHeightSm, height: spacing.rowHeightSm, borderRadius: borderRadius.lg, backgroundColor: colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' }, menuTitle: { ...typography.bodyMd, fontWeight: '600', color: colors.homeAction }, caption: { ...typography.labelSm, color: colors.secondary, marginTop: spacing.xs },
  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: spacing.rowHeightStandard, borderWidth: 1, borderColor: colors.errorContainer, borderRadius: borderRadius.lg, marginTop: spacing.sm }, logoutText: { ...typography.bodyMd, color: colors.error, fontWeight: '600' },
  errorCard: { padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.errorContainer }, errorText: { ...typography.bodyMd, color: colors.onErrorContainer }, retry: { minHeight: spacing.rowHeightSm, justifyContent: 'center' },
});
