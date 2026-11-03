import React, { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../../components/atoms/Icon';
import { AppHeader } from '../../components/molecules/AppHeader';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { borderRadius, colors, spacing, typography } from '../../theme';
import type { AccountScreenProps } from '../../types/navigation';

const permissions = [
  { title: 'Location', icon: 'location_on', text: 'Location supports nearby trips, navigation and trip tracking. Review the access granted to this app in Android settings.' },
  { title: 'Camera and document uploads', icon: 'photo_camera', text: 'Taking or selecting a document image uses the existing document upload and verification flow. Camera and photo permissions appear in Android settings when applicable.' },
  { title: 'Notifications and device data', icon: 'notifications', text: 'Notifications support trip and account updates. Push registration uses a device notification token. Notification access can be managed in Android settings.' },
];
export function DataPermissionsScreen({ navigation }: AccountScreenProps<'DataPermissions'>) {
  const [error, setError] = useState<string | null>(null);
  return <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
    <AppHeader title="Data and Permissions" onBackPress={() => navigation.goBack()} />
    <ScrollView contentContainerStyle={styles.content}>
      {permissions.map(item => <View key={item.title} style={styles.card}>
        <Icon name={item.icon} size={22} color={colors.navigationIcon} />
        <Text style={styles.title}>{item.title}</Text><Text style={styles.body}>{item.text}</Text>
      </View>)}
      <Text style={styles.body}>These are app permission controls. See the Privacy Policy for the published rules on data use, retention and rights.</Text>
      <PrimaryButton label="Open Android app settings" onPress={() => {
        setError(null); Linking.openSettings().catch(() => setError('Could not open app settings. Open Settings on your device and select MultipleRide Partner.'));
      }} />
      {error ? <Text accessibilityRole="alert" style={styles.body}>{error}</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface }, content: { padding: spacing.containerPadding, gap: spacing.containerPadding, width: '100%', maxWidth: 720, alignSelf: 'center', paddingBottom: spacing.xl },
  card: { padding: spacing.containerPadding, gap: spacing.xs, borderRadius: borderRadius.xl, backgroundColor: colors.surfaceContainerLowest, borderWidth: 1, borderColor: colors.outlineSubtle },
  title: { ...typography.headlineSm, color: colors.onSurface }, body: { ...typography.bodyMd, color: colors.onSurfaceMuted },
});
