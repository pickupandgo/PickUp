import React, { useEffect, useState } from 'react';
import { Alert, AppState, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../../components/molecules/AppHeader';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { floatingPanel } from '../../services/tracking/FloatingPanel';
import { colors, spacing, typography } from '../../theme';
import type { AccountScreenProps } from '../../types/navigation';

export function FloatingWindowScreen({ navigation }: AccountScreenProps<'FloatingWindow'>) {
  const [state, setState] = useState({ enabled: false, permission: false });
  const [error, setError] = useState<string | null>(null);
  const refresh = () => floatingPanel.status().then(setState).catch(() => setError('Could not read floating window settings.'));
  useEffect(() => {
    refresh(); const app = AppState.addEventListener('change', next => { if (next === 'active') refresh(); });
    return () => app.remove();
  }, []);
  const permission = () => Alert.alert('Floating window permission',
    'Allow MultipleRide Partner to show a small draggable panel over other apps while you are Online. It displays trip status and lets you reopen Partner. Android notifications and Online sharing still work without this permission.',
    [{ text: 'Not now', style: 'cancel' }, { text: 'Open Android settings', onPress: () => { floatingPanel.permission().catch(() => setError('Open Android settings manually to grant display-over-other-apps permission.')); } }]);
  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
    <AppHeader title="Floating window" showBackButton onBackPress={() => navigation.goBack()} />
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Stay aware while using other apps</Text>
      <Text style={styles.body}>An optional compact panel appears when Partner is minimized and your user-started Online location service is running. Drag its header, collapse it, hide it, or tap Open to return. Trip actions reopen Partner and use the same authenticated backend checks.</Text>
      <View style={styles.row}><Text style={styles.body}>Enable floating window</Text><Switch accessibilityLabel="Enable floating window" value={state.enabled} onValueChange={value => {
        floatingPanel.enable(value).then(refresh).then(() => { if (value && !state.permission) permission(); }).catch(() => setError('Could not update the floating window.'));
      }} /></View>
      <Text style={styles.body}>Android overlay permission: {state.permission ? 'Allowed' : 'Not allowed'}</Text>
      {!state.permission && <PrimaryButton label="Allow display over other apps" onPress={permission} />}
      <Text style={styles.body}>Disabling or denying this permission does not disable normal notifications. The panel hides while the phone is locked and when you go Offline or sign out.</Text>
      {error && <Text accessibilityLiveRegion="polite" style={styles.body}>{error}</Text>}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.surface }, content: { padding: spacing.containerPadding, gap: spacing.md },
  title: { ...typography.headlineMd, color: colors.onSurface }, body: { ...typography.bodyMd, color: colors.onSurfaceVariant }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm } });
