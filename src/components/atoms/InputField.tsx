import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { colors, spacing, borderRadius, typography } from '../../theme';

export interface InputFieldProps {
  readonly placeholder?: string;
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly label?: string;
  readonly error?: string;
  readonly icon?: React.ReactNode;
  readonly keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad';
  readonly secureTextEntry?: boolean;
  readonly editable?: boolean;
  readonly multiline?: boolean;
  readonly maxLength?: number;
}

const InputField: React.FC<InputFieldProps> = ({
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
}) => {
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
          accessibilityLabel={label || placeholder}
        />
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

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
