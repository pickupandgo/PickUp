import React, { useRef, useEffect, useState } from 'react';
import { View, TextInput, StyleSheet, ViewStyle, Platform } from 'react-native';
import { colors, typography, borderRadius, spacing } from '../../theme';

type TextInputRef = React.ElementRef<typeof TextInput>;

export interface OTPInputProps {
  readonly length?: number;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onComplete?: (value: string) => void;
  readonly hasError?: boolean;
  readonly disabled?: boolean;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const OTPInput: React.FC<OTPInputProps> = ({
  length = 6,
  value,
  onChange,
  onComplete,
  hasError = false,
  disabled = false,
  style,
  testID,
}) => {
  const inputRefs = useRef<Array<TextInputRef | null>>([]);
  const onCompleteRef = useRef(onComplete);
  const latestValue = useRef(value);
  const insertionIndex = useRef<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  useEffect(() => {
    latestValue.current = value;
    if (!value) insertionIndex.current = null;
  }, [value]);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (value.length === length && onCompleteRef.current) {
      onCompleteRef.current(value);
    }
  }, [value, length]);

  const handleChange = (text: string, index: number) => {
    const sanitized = text.replace(/[^0-9]/g, '');
    // Native maxLength=1 truncates a paste before onChangeText can receive it.
    // Sanitize and cap in JS instead; a pasted code replaces the whole value
    // regardless of which cell received it (including keyboard OTP suggestions).
    if (text.length > 1 && sanitized) {
      const pasted = sanitized.slice(0, length);
      insertionIndex.current = null;
      latestValue.current = pasted;
      onChange(pasted);
      inputRefs.current[Math.min(pasted.length, length - 1)]?.focus();
      return;
    }
    if (text && !sanitized) return;

    // Keep a contiguous authoritative value. After deletion, typing in the
    // same cell inserts before the shifted suffix instead of losing a digit.
    const current = latestValue.current;
    const position = Math.min(index, current.length);
    const joined = (
      current.slice(0, position) + sanitized +
      current.slice(position + (sanitized && insertionIndex.current === position ? 0 : 1))
    ).slice(0, length);
    insertionIndex.current = sanitized ? null : position;
    latestValue.current = joined;
    onChange(joined);

    if (sanitized && position < length - 1) {
      inputRefs.current[position + 1]?.focus();
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    const current = latestValue.current;
    if (key === 'Backspace' && !current[index] && current.length > 0) {
      const previousIndex = Math.min(index, current.length) - 1;
      const next = current.slice(0, previousIndex) + current.slice(previousIndex + 1);
      latestValue.current = next;
      insertionIndex.current = previousIndex;
      onChange(next);
      inputRefs.current[previousIndex]?.focus();
    }
  };

  return (
    <View style={[styles.container, style]} testID={testID} accessibilityRole="none">
      {Array.from({ length }, (_, index) => (
        <TextInput
          key={index}
          ref={(ref) => {
            inputRefs.current[index] = ref;
          }}
          style={[
            styles.cell,
            focusedIndex === index ? styles.cellFocused : null,
            hasError ? styles.cellError : null,
          ]}
          value={value[index] || ''}
          onChangeText={(text) => handleChange(text, index)}
          onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, index)}
          onFocus={() => {
            setFocusedIndex(index);
            if (insertionIndex.current !== index) insertionIndex.current = null;
          }}
          onBlur={() => setFocusedIndex(null)}
          keyboardType="number-pad"
          autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
          importantForAutofill="yes"
          autoCorrect={false}
          autoCapitalize="none"
          editable={!disabled}
          selectTextOnFocus
          selection={{ start: 0, end: value[index] ? 1 : 0 }}
          accessibilityLabel={`OTP digit ${index + 1}`}
          accessibilityRole="none"
          testID={`${testID}-cell-${index}`}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
  },
  cell: {
    flex: 1,
    minWidth: 0,
    maxWidth: 48,
    height: 56,
    borderWidth: 1,
    borderColor: colors.onSurface,
    borderRadius: borderRadius.md,
    textAlign: 'center',
    ...typography.headlineMd,
    color: colors.onSurface,
    backgroundColor: colors.surfaceContainerLowest,
  },
  cellFocused: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceContainerLowest,
  },
  cellError: {
    borderColor: colors.error,
    backgroundColor: colors.errorContainer,
  },
});

export default OTPInput;
