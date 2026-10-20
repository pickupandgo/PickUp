import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { AppHeader } from '../../components/molecules/AppHeader';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import Icon from '../../components/atoms/Icon';
import { useI18n, type Locale } from '../../i18n';
import type { AuthScreenProps } from '../../types/navigation';

export interface LanguageSelectionScreenProps {
  readonly navigation: AuthScreenProps<'LanguageSelection'>['navigation'];
  readonly testID?: string;
}

export const LanguageSelectionScreen: React.FC<LanguageSelectionScreenProps> = ({
  navigation,
  testID,
}) => {
  const { locale, setLocale } = useI18n();
  const [selectedLanguage, setSelectedLanguage] = useState<Locale>(locale);

  useEffect(() => {
    setSelectedLanguage(locale);
  }, [locale]);

  const isHindi = selectedLanguage === 'hi';

  const screenTitle = isHindi ? 'भाषा' : 'Language';
  const screenSubtitle = isHindi
    ? 'Multiple Ride Partner ऐप के लिए अपनी पसंदीदा भाषा चुनें।'
    : 'Select your preferred language for the Multiple Ride Partner app.';
  const confirmButtonLabel = isHindi ? 'पुष्टि करें' : 'Confirm';

  const languageOptions = [
    { id: 'en' as const, label: 'English', initial: 'E' },
    { id: 'hi' as const, label: isHindi ? 'हिन्दी' : 'Hindi', initial: isHindi ? 'ह' : 'H' },
  ];

  const handleContinue = () => {
    setLocale(selectedLanguage);
    navigation.navigate('VehicleSelection', { language: selectedLanguage });
  };

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title={screenTitle}
        onBackPress={() => navigation.goBack()}
        showBackButton={false}
        trailingIconName="help_outline"
        onTrailingPress={() => {}}
        showDivider
      />
      <View style={styles.container}>
        <Text style={styles.subtitle}>{screenSubtitle}</Text>
        <FlatList
          data={languageOptions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const isSelected = item.id === selectedLanguage;
            return (
              <Pressable
                style={[styles.row, isSelected ? styles.rowSelected : styles.rowUnselected]}
                onPress={() => setSelectedLanguage(item.id)}
                accessibilityRole="radio"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: isSelected }}
              >
                <View style={[styles.initialContainer, isSelected && styles.initialContainerSelected]}>
                  <Text style={[styles.initialText, isSelected && styles.initialTextSelected]}>{item.initial}</Text>
                </View>
                <View style={styles.rowContent}>
                  <Text style={styles.rowName}>{item.label}</Text>
                </View>
                {isSelected ? (
                  <Icon name="check_circle" style={styles.checkIcon} />
                ) : (
                  <Icon name="radio_button_unchecked" style={styles.uncheckIcon} />
                )}
              </Pressable>
            );
          }}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: spacing.gutter }} />}
        />
        <PrimaryButton
          label={confirmButtonLabel}
          onPress={handleContinue}
          style={styles.continueButton}
        />
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
    paddingBottom: spacing.containerPadding,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.containerPadding,
    paddingHorizontal: spacing.containerPadding,
    borderRadius: borderRadius.md,
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
  rowContent: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    ...typography.bodyMd,
    fontWeight: '500',
    color: colors.onSurface,
  },
  initialContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.gutter,
  },
  initialContainerSelected: {
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
  checkIcon: {
    fontSize: 24,
    color: colors.primary,
  },
  uncheckIcon: {
    fontSize: 24,
    color: colors.outline,
  },
  continueButton: {
    marginBottom: spacing.lg,
  },
});

export default LanguageSelectionScreen;
