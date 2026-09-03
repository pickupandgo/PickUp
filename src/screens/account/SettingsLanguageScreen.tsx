import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../../components/atoms/Icon';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { AppHeader } from '../../components/molecules/AppHeader';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { useI18n, type Locale } from '../../i18n';
import type { AccountScreenProps } from '../../types/navigation';

export interface SettingsLanguageScreenProps {
  readonly navigation: AccountScreenProps<'LanguageSelection'>['navigation'];
  readonly testID?: string;
}

export const SettingsLanguageScreen: React.FC<SettingsLanguageScreenProps> = ({ navigation, testID }) => {
  const { t, locale, setLocale } = useI18n();
  const [selected, setSelected] = useState<Locale>(locale);

  const options: { id: Locale; label: string; initial: string }[] = [
    { id: 'en', label: t('language.english'), initial: 'E' },
    { id: 'hi', label: t('language.hindi'), initial: 'H' },
  ];

  const handleConfirm = useCallback(() => {
    setLocale(selected);
    navigation.goBack();
  }, [selected, setLocale, navigation]);

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title={t('language.title')}
        onBackPress={() => navigation.goBack()}
        showBackButton
        showDivider
      />
      <View style={styles.container}>
        <Text style={styles.subtitle}>{t('language.subtitle')}</Text>

        <View style={styles.list}>
          {options.map((item) => {
            const isSelected = item.id === selected;
            return (
              <Pressable
                key={item.id}
                style={[styles.row, isSelected ? styles.rowSelected : styles.rowUnselected]}
                onPress={() => setSelected(item.id)}
                accessibilityRole="radio"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: isSelected }}
              >
                <View style={[styles.initialCircle, isSelected && styles.initialCircleSelected]}>
                  <Text style={[styles.initialText, isSelected && styles.initialTextSelected]}>
                    {item.initial}
                  </Text>
                </View>
                <Text style={styles.rowName}>{item.label}</Text>
                <Icon
                  name={isSelected ? 'check_circle' : 'radio_button_unchecked'}
                  size={24}
                  color={isSelected ? colors.primary : colors.outline}
                />
              </Pressable>
            );
          })}
        </View>

        <View style={styles.footer}>
          <PrimaryButton label={t('language.confirm')} onPress={handleConfirm} />
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.containerPadding,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  list: {
    flex: 1,
    gap: spacing.gutter,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.containerPadding,
    paddingHorizontal: spacing.containerPadding,
    borderRadius: borderRadius.lg,
  },
  rowUnselected: {
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowSelected: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  rowName: {
    flex: 1,
    ...typography.bodyMd,
    fontWeight: '500',
    color: colors.onSurface,
  },
  initialCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.gutter,
  },
  initialCircleSelected: {
    backgroundColor: colors.primary,
  },
  initialText: {
    ...typography.bodyMd,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
  },
  initialTextSelected: {
    color: colors.onPrimary,
  },
  footer: {
    paddingBottom: spacing.lg,
  },
});

export default SettingsLanguageScreen;
