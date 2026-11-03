import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { notificationPreferences, type NotificationPreferences as Preferences } from '../../services/notifications/NotificationApi';
import { colors, spacing, typography } from '../../theme';

const labels: Record<keyof Preferences, string> = { tripRequests: 'Trip requests', tripUpdates: 'Trip updates',
  walletPayments: 'Wallet and payments', verification: 'Verification', announcements: 'Account announcements', soundEnabled: 'Notification sounds' };
export function NotificationPreferences() {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    notificationPreferences().then(value => { if (active) setPrefs(value); }).catch(() => {
      if (active) setError('Notification preferences are currently unavailable. Please try again later.');
    });
    return () => { active = false; };
  }, [open]);
  const save = async (key: keyof Preferences, value: boolean) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { setPrefs(await notificationPreferences({ [key]: value })); }
    catch { setError('Your change was not confirmed. Please retry.'); }
    finally { setBusy(false); }
  };
  return <View>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.row} onPress={() => { setError(null); setOpen(value => !value); }}>
      <Text style={styles.action}>Notification preferences</Text>
    </Pressable>
    {open && <>
      <Text style={styles.body}>These controls affect optional push alerts. Important account and security notices remain enabled. All events remain in your inbox. Android notification settings control whether alerts can appear or make sounds.</Text>
      {prefs && (Object.keys(labels) as (keyof Preferences)[]).map(key => <View style={styles.row} key={key}>
        <Text style={styles.label}>{labels[key]}</Text><Switch accessibilityLabel={labels[key]} value={prefs[key]} disabled={busy}
          onValueChange={value => { save(key, value).catch(() => {}); }} />
      </View>)}
      {error && <Text accessibilityRole="alert" style={styles.body}>{error}</Text>}
    </>}
  </View>;
}
const styles = StyleSheet.create({ row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  body: { ...typography.bodyMd, color: colors.onSurfaceMuted }, label: { ...typography.bodyMd, color: colors.onSurface, flex: 1 },
  action: { ...typography.bodyMd, color: colors.startupBlue } });
