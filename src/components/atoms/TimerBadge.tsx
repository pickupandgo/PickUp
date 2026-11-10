import React, { useEffect, useRef, useState } from 'react';
import { AppState, View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, typography, borderRadius, spacing } from '../../theme';

export interface TimerBadgeProps {
  readonly expiresAt: number;
  readonly onExpired?: () => void;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const TimerBadge: React.FC<TimerBadgeProps> = ({
  expiresAt,
  onExpired,
  style,
  testID,
}) => {
  const [secondsLeft, setSecondsLeft] = useState(() => {
    const diff = Number.isFinite(expiresAt) ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)) : 0;
    return diff;
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callback = useRef(onExpired);
  callback.current = onExpired;

  useEffect(() => {
    let expired = false;
    const clear = () => { if (intervalRef.current) clearInterval(intervalRef.current); intervalRef.current = null; };
    const check = () => {
      const remaining = Number.isFinite(expiresAt) ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)) : 0;
      setSecondsLeft(remaining);
      if (remaining <= 0 && !expired) {
        expired = true;
        clear();
        callback.current?.();
      }
    };
    const resume = () => {
      clear(); check();
      if (!expired && AppState.currentState !== 'background' && AppState.currentState !== 'inactive')
        intervalRef.current = setInterval(check, 250);
    };
    resume();
    const subscription = AppState.addEventListener('change', state => state === 'active' ? resume() : clear());

    return () => {
      clear(); subscription.remove();
    };
  }, [expiresAt]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const isUrgent = secondsLeft <= 10;

  return (
    <View
      style={[
        styles.container,
        isUrgent && styles.urgent,
        style,
      ]}
      testID={testID}
      accessibilityRole="timer"
      accessibilityLabel={`${secondsLeft} seconds remaining`}
    >
      <Text style={[styles.label, isUrgent && styles.labelUrgent]}>
        {formatted}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.unit,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary,
    alignSelf: 'center',
  },
  urgent: {
    backgroundColor: colors.error,
  },
  label: {
    ...typography.dataMono,
    color: colors.onPrimary,
    textAlign: 'center',
  },
  labelUrgent: {
    color: colors.onError,
  },
});

export default TimerBadge;
