import React, { useRef } from 'react';
import { View, Text, Image, Pressable, StyleSheet, TextInput } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from '../../components/organisms';
import InputField, { type InputFieldProps } from '../../components/atoms/InputField';
import Button, { type ButtonProps } from '../../components/atoms/Button';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { APP_NAME, APP_LOGO } from '../../config/brand';

export const authStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface },
  content: { flexGrow: 1, paddingHorizontal: spacing.xxl, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xxxl },
  logo: { width: spacing.rowHeightSm, height: spacing.rowHeightSm },
  wordmark: { ...typography.headlineSm, color: colors.primary, flexShrink: 1 },
  back: { minWidth: spacing.rowHeightSm, minHeight: spacing.rowHeightStandard, justifyContent: 'center' },
  title: { ...typography.authTitle, color: colors.primary, marginBottom: spacing.sm },
  body: { ...typography.bodyMd, color: colors.onSurfaceVariant, marginBottom: spacing.xxl },
  form: { gap: spacing.lg },
  button: { minHeight: spacing.rowHeightStandard, borderRadius: borderRadius.lg },
  disabledButton: { opacity: 1, backgroundColor: colors.surfaceContainerHigh },
  loadingButton: { opacity: 1, backgroundColor: colors.primary },
  disabledButtonText: { color: colors.onSurfaceVariant },
  link: { ...typography.bodyMd, color: colors.primary, fontWeight: '500' },
  action: { minHeight: spacing.rowHeightStandard, justifyContent: 'center', paddingHorizontal: spacing.sm },
  error: { ...typography.bodyMd, color: colors.error, marginVertical: spacing.md },
  hint: { ...typography.labelSm, color: colors.onSurfaceVariant, marginTop: spacing.md },
  badge: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceContainerLow,
    padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.xxl },
  badgeText: { ...typography.bodyMd, color: colors.onSurfaceVariant, flexShrink: 1 },
});

/** One explicit palette for enabled, disabled and loading authentication actions. */
export function AuthButton(props: ButtonProps) {
  return <Button {...props} disabledStyle={props.loading ? authStyles.loadingButton : authStyles.disabledButton}
    disabledTextStyle={authStyles.disabledButtonText} />;
}

export function AuthLayout({ children, onBack, onSignOut, busy = false }: {
  children: React.ReactNode; onBack?: () => void; onSignOut?: () => void; busy?: boolean;
}) {
  return <SafeAreaView style={authStyles.page} edges={['top', 'bottom']}>
    <KeyboardAwareScrollView contentContainerStyle={authStyles.content} keyboardShouldPersistTaps="handled">
      <View style={authStyles.header}>
        {onBack && <Pressable accessibilityRole="button" accessibilityLabel="Go back" disabled={busy}
          onPress={onBack} style={authStyles.back}><Feather name="arrow-left" size={spacing.xxl} color={colors.primary} /></Pressable>}
        <Image source={APP_LOGO} style={authStyles.logo}
          resizeMode="contain" accessibilityLabel={`${APP_NAME} logo`} />
        <Text style={authStyles.wordmark} numberOfLines={1} adjustsFontSizeToFit>{APP_NAME}</Text>
        <View style={{ flex: 1 }} />
        {onSignOut && <Pressable onPress={onSignOut} disabled={busy} accessibilityRole="button"
          accessibilityLabel="Sign out" style={authStyles.action}><Text style={authStyles.link}>Sign out</Text></Pressable>}
      </View>
      {children}
    </KeyboardAwareScrollView>
  </SafeAreaView>;
}

export function MobileField(props: InputFieldProps) {
  const inputRef = useRef<TextInput>(null);
  return <InputField ref={inputRef} label="Mobile number" placeholder="10-digit mobile number"
    keyboardType="phone-pad" autoComplete="tel-national" textContentType="telephoneNumber"
    autoCorrect={false} maxLength={18} icon={<Text style={authStyles.link}>+91</Text>} {...props} />;
}

