import { usePartnerProfile } from '../../hooks/usePartnerProfile';
import { useLocalAvatar } from '../../hooks/useLocalAvatar';
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
import { getAuth } from '@react-native-firebase/auth';
import Icon from '../../components/atoms/Icon';
import { colors } from '../../theme';
import { AccountHeader, AccountGroup } from '../../components/account/AccountLayout';
import { SettingsRow } from '../../components/molecules/SettingsRow';
import type { AccountScreenProps } from '../../types/navigation';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../../i18n';
import { useDriverOnboarding } from '../../hooks/useDriverOnboarding';
import { DocumentNavigationCard } from '../../components/documents/DocumentNavigationCard';

export interface ProfileScreenProps {
  readonly navigation: AccountScreenProps<'Profile'>['navigation'];
  readonly testID?: string;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  navigation,
  testID,
}) => {
  const { logout, error: authError, isLoading: authBusy } = useAuth();
  const { t } = useI18n();
  const { summary } = useDriverOnboarding();
  const avatar = useLocalAvatar();
  const profile = usePartnerProfile();

  const firebaseUser = getAuth().currentUser;
  const name =
    profile.profile?.name ||
    summary?.profileName ||
    firebaseUser?.displayName ||
    firebaseUser?.phoneNumber ||
    'Driver';

  const handleSettings = useCallback(
    () => navigation.navigate('Settings'),
    [navigation],
  );
  const handleLogout = useCallback(() => {
    Alert.alert(t('profile.logoutTitle'), t('profile.logoutMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.logout'),
        style: 'destructive',
        onPress: () => {
          void logout().catch(() =>
            Alert.alert('Could not sign out', 'Please try again.'),
          );
        },
      },
    ]);
  }, [logout, t]);

  const resolvedAvatar = profile.profile?.photoUrl || avatar.uri;

  return (
    <SafeAreaView style={styles.safeArea} testID={testID} edges={['top', 'left', 'right']}>
      <AccountHeader title="Account" />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.profileCard}>
          <View style={styles.profileRow}>
            <Pressable style={styles.avatarWrap} onPress={profile.profile?.photoUrl ? () => navigation.navigate('EditProfile') : avatar.choose} disabled={avatar.busy}
              accessibilityLabel={profile.profile?.photoUrl ? 'Edit profile photo and details' : 'Change device photo'} accessibilityState={{ busy: avatar.busy }} accessibilityRole="button">
              {resolvedAvatar ? <Image key={`${avatar.uid}:${resolvedAvatar}`} source={{ uri: resolvedAvatar }} onError={avatar.remove} style={styles.avatarImg} /> :
                <View style={styles.avatarPlaceholder}><Icon name="person" size={35} color={colors.homeMuted} /></View>}
              <View style={styles.avatarEditBadge}>
                {avatar.busy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Icon name="photo_camera" size={12} color={colors.onPrimary} />}
              </View>
            </Pressable>
            <View style={styles.profileText}>
              <Text style={styles.name}>{name}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Edit Profile" onPress={() => navigation.navigate('EditProfile')}><Text>Edit Profile</Text></Pressable>
              <Text style={styles.subtitle}>Driver account</Text>
              <Text style={styles.photoNote}>Photo saved on this device only.</Text>
            </View>
          </View>
          {avatar.error ? <Text accessibilityRole="alert" style={styles.error}>{avatar.error}</Text> : null}
          {avatar.uri && !profile.profile?.photoUrl ? <Pressable accessibilityRole="button" accessibilityLabel="Remove device photo" disabled={avatar.busy} onPress={avatar.remove} style={styles.removePhoto}>
            <Text style={styles.removePhotoLabel}>Remove device photo</Text>
          </Pressable> : null}
        </View>

        <View>
          <Text style={styles.sectionHeading}>DRIVER</Text>
          <AccountGroup>
            <DocumentNavigationCard title="Documents" subtitle="Personal, vehicle & KYC" icon="folder_open" compact mint
              onPress={() => navigation.navigate('DocumentsHub')} />
            <SettingsRow label={t('profile.settings')} subtitle="Preferences, help & privacy" iconName="settings" compact last onPress={handleSettings} />
          </AccountGroup>
        </View>

        <Pressable onPress={handleLogout} disabled={authBusy} accessibilityRole="button" accessibilityLabel="Sign out"
          accessibilityState={{ disabled: authBusy, busy: authBusy }} style={({ pressed }) => [styles.logoutBtn, (pressed || authBusy) && styles.dimmed]}>
          {authBusy ? <ActivityIndicator size="small" color={colors.error} /> : <Icon name="logout" size={20} color={colors.error} />}
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>
        {authError ? <Text accessibilityRole="alert" style={styles.error}>{authError}</Text> : null}
        <Text style={styles.brandFooter}>Multiple Ride Partner</Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surfaceContainerLowest },
  scrollContent: { flexGrow: 1, width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 28, gap: 28 },
  profileCard: { borderWidth: 1, borderColor: colors.homeBorder, borderRadius: 12, padding: 16, gap: 10 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatarWrap: { width: 56, height: 56 },
  avatarImg: { width: 56, height: 56, borderRadius: 28 },
  avatarPlaceholder: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  avatarEditBadge: { position: 'absolute', right: -2, bottom: -1, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.homeGreen, borderWidth: 2, borderColor: colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  profileText: { flex: 1, minWidth: 0, gap: 4 },
  name: { fontSize: 15, lineHeight: 21, fontWeight: '600', color: colors.primary },
  subtitle: { fontSize: 12, lineHeight: 18, color: colors.onSurfaceMuted },
  photoNote: { fontSize: 10, lineHeight: 16, color: colors.onSurfaceMuted, marginTop: 5 },
  removePhoto: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  removePhotoLabel: { fontSize: 11, lineHeight: 17, color: colors.onSurfaceMuted },
  sectionHeading: { fontSize: 10, lineHeight: 16, fontWeight: '600', letterSpacing: 0.8, color: colors.onSurfaceMuted, marginBottom: 12, marginLeft: 3 },
  logoutBtn: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: colors.homeBorder, borderRadius: 11 },
  logoutText: { fontSize: 13, lineHeight: 19, fontWeight: '500', color: colors.error },
  dimmed: { opacity: 0.6 },
  error: { fontSize: 12, lineHeight: 18, color: colors.error },
  brandFooter: { marginTop: 'auto', paddingTop: 28, textAlign: 'center', fontSize: 11, lineHeight: 17, color: colors.onSurfaceMuted },
});

export default ProfileScreen;
