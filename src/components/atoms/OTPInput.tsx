import React, { useRef, useEffect } from 'react';
import { View, TextInput, StyleSheet, ViewStyle } from 'react-native';
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
    if (sanitized.length > 1) {
      // Handle paste
      const pasted = sanitized.slice(0, length);
      onChange(pasted);
      const lastIndex = Math.min(pasted.length, length) - 1;
      inputRefs.current[lastIndex]?.focus();
      return;
    }

    const newValue = value.split('');
    newValue[index] = sanitized;
    const joined = newValue.join('').slice(0, length);
    onChange(joined);

    if (sanitized && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !value[index] && index > 0) {
      const newValue = value.split('');
      newValue[index - 1] = '';
      onChange(newValue.join(''));
      inputRefs.current[index - 1]?.focus();
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
            value[index] ? styles.cellFilled : null,
            hasError ? styles.cellError : null,
          ]}
          value={value[index] || ''}
          onChangeText={(text) => handleChange(text, index)}
          onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, index)}
          keyboardType="number-pad"
          maxLength={1}
          editable={!disabled}
          selectTextOnFocus
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
    width: 48,
    height: 56,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: borderRadius.md,
    textAlign: 'center',
    ...typography.headlineMd,
    color: colors.onSurface,
    backgroundColor: colors.surfaceContainerLowest,
  },
  cellFilled: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceContainerLowest,
  },
  cellError: {
    borderColor: colors.error,
    backgroundColor: colors.errorContainer,
  },
});

export default OTPInput;
