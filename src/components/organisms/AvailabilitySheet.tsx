import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../atoms/Icon';
import { colors } from '../../theme';

interface AvailabilitySheetProps {
  readonly online: boolean;
  readonly onConfirm: () => void;
  readonly onDismiss: () => void;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

/** Presentation only: availability and permission changes remain owned by Home. */
export function AvailabilitySheet({ online, onConfirm, onDismiss, style, testID }: AvailabilitySheetProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <View testID={testID} accessibilityViewIsModal
      style={[styles.sheet, { maxHeight: Math.max(0, height - insets.top - 20) }, style]}>
      <View style={styles.handle} accessible={false} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} bounces={false}>
        <View style={styles.header}>
          <View style={[styles.iconCircle, online && styles.iconCircleOnline]}>
            <Icon name="power_settings_new" size={22} color={online ? colors.homeGreen : colors.onSurfaceMuted} />
          </View>
          <Text style={styles.eyebrow}>AVAILABILITY</Text>
          <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Close availability confirmation"
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
            <Icon name="close" size={22} color={colors.primary} />
          </Pressable>
        </View>
        <Text style={styles.title} accessibilityRole="header">{online ? 'Ready to go online?' : 'Take a break?'}</Text>
        <Text style={styles.subtitle}>{online ? 'Receive trip requests near you.' : 'Go offline to pause new trip requests.'}</Text>
        {online ? (
          <View style={styles.onlineDetails}>
            <Text style={styles.sectionTitle}>Your location, while online</Text>
            <View style={styles.detailRow}>
              <Icon name="location_on" size={21} color={colors.primary} />
              <Text style={styles.detailText}>
                Multiple Ride Partner collects and shares your precise location with our trip service while you’re online,
                and with your assigned customer during an active delivery.
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Icon name="phonelink_lock" size={21} color={colors.primary} />
              <Text style={styles.detailText}>
                Sharing continues when the app is minimized or the screen is locked. Android uses a location foreground service.
              </Text>
            </View>
            <Text style={styles.footnote}>Sharing stops when you go offline with no active trip, or sign out.</Text>
          </View>
        ) : (
          <View style={styles.offlineDetails}>
            <View style={styles.detailRow}>
              <Icon name="pause_circle_outline" size={21} color={colors.onSurfaceMuted} />
              <Text style={styles.detailText}>New requests will pause.</Text>
            </View>
            <View style={styles.detailRow}>
              <Icon name="location_on" size={21} color={colors.onSurfaceMuted} />
              <Text style={styles.detailText}>Location sharing stops when no trip is active.</Text>
            </View>
            <Text style={styles.footnote}>Come back online whenever you’re ready.</Text>
          </View>
        )}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable onPress={onConfirm} accessibilityRole="button" accessibilityLabel={online ? 'Go online' : 'Go offline'}
          style={({ pressed }) => [styles.primaryButton, online && styles.onlineButton, pressed && styles.pressed]}>
          <Text style={styles.primaryLabel}>{online ? 'Go online' : 'Go offline'}</Text>
          {online && <View style={styles.arrow}><Icon name="arrow_forward" size={20} color={colors.onPrimary} /></View>}
        </Pressable>
        <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel={online ? 'Not now' : 'Stay online'}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
          <Text style={[styles.secondaryLabel, !online && styles.stayOnline]}>{online ? 'Not now' : 'Stay online'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: colors.surfaceContainerLowest, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden', flexShrink: 1 },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: colors.outlineVariant, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 22 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  iconCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  iconCircleOnline: { backgroundColor: colors.homeMint },
  eyebrow: { flex: 1, fontSize: 11, lineHeight: 16, letterSpacing: 1, fontWeight: '500', color: colors.onSurfaceMuted },
  close: { width: 44, height: 44, marginRight: -10, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, lineHeight: 27, fontWeight: '600', color: colors.primary },
  subtitle: { fontSize: 13, lineHeight: 19, color: colors.onSurfaceMuted, marginTop: 6 },
  onlineDetails: { marginTop: 22, paddingTop: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.homeBorder, gap: 18 },
  offlineDetails: { marginTop: 24, gap: 18 },
  sectionTitle: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: colors.primary },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  detailText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 19, color: colors.navigationIcon },
  footnote: { fontSize: 12, lineHeight: 18, color: colors.onSurfaceMuted },
  footer: { marginHorizontal: 20, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.homeBorder, flexShrink: 0, gap: 4 },
  primaryButton: { minHeight: 48, backgroundColor: colors.primary, borderRadius: 11, paddingVertical: 12, paddingHorizontal: 44, justifyContent: 'center', alignItems: 'center' },
  onlineButton: { backgroundColor: colors.homeGreen },
  primaryLabel: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: colors.onPrimary, textAlign: 'center' },
  arrow: { position: 'absolute', right: 16 },
  secondaryButton: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  secondaryLabel: { fontSize: 13, lineHeight: 19, fontWeight: '500', color: colors.onSurfaceMuted },
  stayOnline: { color: colors.homeGreen },
  pressed: { opacity: 0.7 },
});
