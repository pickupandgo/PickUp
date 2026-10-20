import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { colors, spacing, borderRadius, typography } from '../../theme';
import Button from '../../components/atoms/Button';
import { useI18n, type Locale } from '../../i18n';

export interface LanguageSelectionScreenProps {
  readonly navigation?: any;
  readonly onBack?: () => void;
  readonly onConfirm?: (locale: Locale) => void;
}

export const LanguageSelectionScreen: React.FC<LanguageSelectionScreenProps> = ({
  navigation,
  onBack,
  onConfirm,
}) => {
  const { locale, setLocale } = useI18n();
  const [selected, setSelected] = useState<Locale>(locale);

  useEffect(() => {
    setSelected(locale);
  }, [locale]);

  const isHindi = selected === 'hi';

  // Requirement 2 exact copy
  const screenTitle = isHindi ? 'भाषा' : 'Language';
  const screenSubtitle = isHindi
    ? 'कस्टमर ऐप के लिए अपनी पसंदीदा भाषा चुनें।'
    : 'Select your preferred language for the Customer app.';
  const confirmButtonLabel = isHindi ? 'पुष्टि करें' : 'Confirm';

  const options: { id: Locale; label: string; subLabel: string; initial: string }[] = [
    {
      id: 'en',
      label: 'English',
      subLabel: isHindi ? 'अंग्रेज़ी' : 'English',
      initial: 'A',
    },
    {
      id: 'hi',
      label: isHindi ? 'हिन्दी' : 'Hindi',
      subLabel: isHindi ? 'देवनागरी लिपि' : 'Devanagari Script',
      initial: 'अ',
    },
  ];

  const handleConfirm = useCallback(async () => {
    await setLocale(selected);
    if (onConfirm) {
      onConfirm(selected);
    } else if (navigation?.canGoBack()) {
      navigation.goBack();
    }
  }, [selected, setLocale, onConfirm, navigation]);

  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
    } else if (navigation?.canGoBack()) {
      navigation.goBack();
    }
  }, [onBack, navigation]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top Bar */}
      <View style={styles.header}>
        {navigation?.canGoBack() ? (
          <Pressable
            style={styles.backButton}
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel={isHindi ? 'पीछे' : 'Back'}
          >
            <Feather name="arrow-left" size={24} color={colors.primary} />
          </Pressable>
        ) : (
          <View style={styles.backButtonPlaceholder} />
        )}
        <Text style={styles.headerTitle}>{screenTitle}</Text>
        <View style={styles.backButtonPlaceholder} />
      </View>

      <View style={styles.container}>
        <Text style={styles.subtitle}>{screenSubtitle}</Text>

        <View style={styles.optionsList}>
          {options.map((option) => {
            const isSelected = option.id === selected;
            return (
              <Pressable
                key={option.id}
                style={[
                  styles.optionCard,
                  isSelected ? styles.optionCardSelected : styles.optionCardUnselected,
                ]}
                onPress={() => setSelected(option.id)}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: isSelected }}
              >
                <View style={[styles.avatar, isSelected && styles.avatarSelected]}>
                  <Text style={[styles.avatarText, isSelected && styles.avatarTextSelected]}>
                    {option.initial}
                  </Text>
                </View>

                <View style={styles.textContainer}>
                  <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>
                    {option.label}
                  </Text>
                  <Text style={styles.optionSubLabel}>{option.subLabel}</Text>
                </View>

                <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}>
                  {isSelected && <View style={styles.radioDot} />}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.footer}>
          <Button
            label={confirmButtonLabel}
            onPress={handleConfirm}
            variant="primary"
            size="lg"
            fullWidth
          />
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonPlaceholder: {
    width: 40,
    height: 40,
  },
  headerTitle: {
    ...typography.headlineSm,
    color: colors.primary,
    fontWeight: '700',
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    justifyContent: 'space-between',
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    marginBottom: spacing.xxl,
    lineHeight: 22,
  },
  optionsList: {
    gap: spacing.md,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  optionCardUnselected: {
    borderWidth: 1.5,
    borderColor: colors.outlineVariant,
  },
  optionCardSelected: {
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: '#F0F9FF',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarSelected: {
    backgroundColor: colors.primary,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.onSurfaceVariant,
  },
  avatarTextSelected: {
    color: '#FFFFFF',
  },
  textContainer: {
    flex: 1,
  },
  optionLabel: {
    ...typography.headlineSm,
    color: colors.onSurface,
    fontWeight: '600',
    marginBottom: 2,
  },
  optionLabelSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
  optionSubLabel: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  radioCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleSelected: {
    borderColor: colors.primary,
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  footer: {
    paddingBottom: spacing.xxl,
    paddingTop: spacing.md,
  },
});

export default LanguageSelectionScreen;
