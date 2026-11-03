import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import type { TripHistoryCounts, TripHistoryFilter } from '../../types/tripHistory';
import { colors, spacing, typography } from '../../theme';
import { useI18n } from '../../i18n';

const options = ['all', 'completed', 'cancelled'] as const;
export function TripSegmentedFilters({ selected, counts, onSelect }: { selected: TripHistoryFilter; counts: TripHistoryCounts | null; onSelect: (filter: TripHistoryFilter) => void }) {
  const { t } = useI18n(); const [width, setWidth] = useState(0); const [reduceMotion, setReduceMotion] = useState(true);
  const position = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduceMotion(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { alive = false; subscription.remove(); };
  }, []);
  const segmentWidth = Math.max(0, (width - 8) / 3);
  useEffect(() => {
    const animation = Animated.timing(position, { toValue: options.indexOf(selected) * segmentWidth, duration: reduceMotion ? 0 : 180, useNativeDriver: true });
    animation.start(); return () => animation.stop();
  }, [position, reduceMotion, selected, segmentWidth]);
  return <View style={styles.outer}><View accessibilityRole="tablist" style={styles.container} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    {width > 0 ? <Animated.View pointerEvents="none" style={[styles.pill, { width: segmentWidth, transform: [{ translateX: position }] }]} /> : null}
    {options.map(option => <Pressable key={option} accessibilityRole="tab" accessibilityLabel={t(`tripHistory.${option}`)} accessibilityState={{ selected: option === selected }}
      style={[styles.option, width === 0 && option === selected && styles.initialSelected]} onPress={() => onSelect(option)}>
      <Text style={[styles.label, option === selected && styles.selectedLabel]}>{t(`tripHistory.${option}`)} ({counts?.[option] ?? '—'})</Text>
    </Pressable>)}
  </View></View>;
}
const styles = StyleSheet.create({
  outer: { paddingHorizontal: spacing.containerPadding, paddingVertical: spacing.sm, width: '100%', maxWidth: 800, alignSelf: 'center' },
  container: { flexDirection: 'row', borderRadius: 28, backgroundColor: colors.surfaceContainerHigh, padding: 4, position: 'relative' },
  pill: { position: 'absolute', left: 4, top: 4, bottom: 4, borderRadius: 24, backgroundColor: colors.primary },
  option: { flex: 1, minWidth: 0, minHeight: 48, justifyContent: 'center', paddingVertical: spacing.xs, paddingHorizontal: spacing.unit, borderRadius: 24 },
  initialSelected: { backgroundColor: colors.primary }, label: { ...typography.labelSm, color: colors.onSurfaceVariant, textAlign: 'center' }, selectedLabel: { color: colors.onPrimary },
});
