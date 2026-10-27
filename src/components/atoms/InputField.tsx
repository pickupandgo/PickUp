import React, { forwardRef, useRef, useImperativeHandle } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  type TextInputProps,
  type NativeSyntheticEvent,
  type TextInputFocusEventData,
} from 'react-native';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { useKeyboardAware } from '../organisms/KeyboardAwareScrollView';

export interface InputFieldProps extends Omit<TextInputProps, 'onChangeText'> {
  readonly placeholder?: string;
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly label?: string;
  readonly error?: string;
  readonly icon?: React.ReactNode;
  readonly keyboardType?:
    | 'default'
    | 'numeric'
    | 'email-address'
    | 'phone-pad'
    | 'number-pad'
    | 'decimal-pad';
  readonly secureTextEntry?: boolean;
  readonly editable?: boolean;
  readonly multiline?: boolean;
  readonly maxLength?: number;
  readonly autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}

const InputField = forwardRef<TextInput, InputFieldProps>(
  (
    {
      placeholder,
      value,
      onChangeText,
      label,
      error,
      icon,
      keyboardType = 'default',
      secureTextEntry = false,
      editable = true,
      multiline = false,
      maxLength,
      autoCapitalize,
      onFocus,
      ...restProps
    },
    ref
  ) => {
    const inputRef = useRef<TextInput | null>(null);
    const { scrollToInput } = useKeyboardAware();

    useImperativeHandle(ref, () => inputRef.current as TextInput);

    const handleFocus = (e: any) => {
      onFocus?.(e);
      if (inputRef.current) {
        scrollToInput(inputRef.current);
      }
    };

    return (
      <View style={styles.wrapper}>
        {label && <Text style={styles.label}>{label}</Text>}
        <View
          style={[
            styles.container,
            error ? styles.containerError : null,
            !editable ? styles.containerDisabled : null,
          ]}
        >
          {icon && <View style={styles.iconContainer}>{icon}</View>}
          <TextInput
            ref={inputRef}
            style={[styles.input, icon ? styles.inputWithIcon : null]}
            placeholder={placeholder}
            placeholderTextColor={colors.outlineVariant}
            value={value}
            onChangeText={onChangeText}
            keyboardType={keyboardType}
            secureTextEntry={secureTextEntry}
            editable={editable}
            multiline={multiline}
            maxLength={maxLength}
            autoCapitalize={autoCapitalize}
            onFocus={handleFocus}
            accessibilityLabel={label || placeholder}
            {...restProps}
          />
        </View>
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>
    );
  }
);

InputField.displayName = 'InputField';

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  label: {
    fontSize: typography.labelSm.fontSize,
    lineHeight: typography.labelSm.lineHeight,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginBottom: spacing.xs,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.outlineHairline,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceContainerLowest,
    minHeight: spacing.rowHeightStandard,
    paddingHorizontal: spacing.lg,
  },
  containerError: {
    borderColor: colors.error,
  },
  containerDisabled: {
    backgroundColor: colors.surfaceContainerLow,
    opacity: 0.6,
  },
  iconContainer: {
    marginRight: spacing.md,
  },
  input: {
    flex: 1,
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: typography.bodyLg.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
    paddingVertical: 0,
  },
  inputWithIcon: {
    paddingLeft: 0,
  },
  errorText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.error,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: spacing.xs,
  },
});

export default InputField;
