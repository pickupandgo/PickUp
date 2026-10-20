import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { mockActiveTrip } from '../../data/mockData';
import { useI18n } from '../../i18n';

export interface DriverRatingScreenProps {
  readonly onClose?: () => void;
  readonly onSubmit?: (rating: number, feedback: string[]) => void;
  readonly onSkip?: () => void;
}

const FEEDBACK_OPTION_KEYS = [
  'feedback.topicProfessionalism',
  'rating.punctuality',
  'rating.carefulHandling',
  'feedback.topicNavigation',
];

const RATING_DESC_KEYS: Record<number, string> = {
  1: 'rating.terrible',
  2: 'rating.poor',
  3: 'rating.okay',
  4: 'rating.good',
  5: 'rating.excellent',
};

const DriverRatingScreen: React.FC<DriverRatingScreenProps & { navigation?: any }> = ({
  onClose,
  onSubmit,
  onSkip,
  navigation,
}) => {
  const { t } = useI18n();
  const [rating, setRating] = useState(0);
  const [selectedFeedback, setSelectedFeedback] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFeedbackToggle = (option: string) => {
    if (selectedFeedback.includes(option)) {
      setSelectedFeedback(selectedFeedback.filter((item) => item !== option));
    } else {
      setSelectedFeedback([...selectedFeedback, option]);
    }
  };

  const handleSubmit = () => {
    setIsSubmitting(true);
    // Simulate API call
    setTimeout(() => {
      onSubmit?.(rating, selectedFeedback);
      setIsSubmitting(false);
      navigation?.navigate('WrittenReviewScreen');
    }, 1000);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable
            style={styles.iconButton}
            onPress={() => (onClose ? onClose() : navigation?.goBack())}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <Feather name="x" size={24} color={colors.onSurfaceVariant} />
          </Pressable>
          <Text style={styles.headerTitle}>{t('home.appName')}</Text>
        </View>
        <Pressable
          style={styles.iconButton}
          onPress={() => navigation?.navigate('NotificationCenterScreen')}
          accessibilityRole="button"
          accessibilityLabel={t('notifications.title')}
        >
          <Feather name="bell" size={24} color={colors.onSurfaceVariant} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.titleContainer}>
          <Text style={styles.title}>{t('rating.howWasDelivery')}</Text>
          <Text style={styles.subtitle}>
            {t('rating.tripRef', { ref: mockActiveTrip.id })}
          </Text>
        </View>

        {/* Driver Info Card */}
        <View style={styles.driverCard}>
          <View style={styles.avatarContainer}>
            <Image
              source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCWntcyPIVgiSDivK0EorrdK-G74AH-FCCM27R9fnQXloBZ8WPOgAVZNkucgODeZqOuhkJW6UDEBmKEvyqDn9XZc3kLo2iqaOQrRgHW4kxG_oc3uUzxh8ebtAfYuaPSEVBwXYFMAJrFK90v1ketbn_ZMUXq2-sUmSfpgbxzjKHEHmPaTAaWE6QsI8OHGQgu50uKCdZQgoXcrd04UoWM3Rh5VUxazpJG5nB53-XZsaAkqDVVnAcFeIcd' }}
              style={styles.avatarImage}
            />
          </View>
          <Text style={styles.driverName}>{mockActiveTrip.driverName.split(' ')[0]}</Text>
          <View style={styles.driverSubRow}>
            <Feather name="truck" size={16} color={colors.onSurfaceVariant} />
            <Text style={styles.driverSubText}>
              {mockActiveTrip.vehicleType} | {mockActiveTrip.vehicleNumber}
            </Text>
          </View>
        </View>

        {/* Rating Section */}
        <View style={styles.ratingSection}>
          <View style={styles.starsContainer}>
            {[1, 2, 3, 4, 5].map((starValue) => (
              <Pressable
                key={starValue}
                onPress={() => setRating(starValue)}
                accessibilityRole="button"
                accessibilityLabel={`${starValue} star`}
              >
                <MaterialIcons
                  name={starValue <= rating ? 'star' : 'star-outline'}
                  size={48}
                  color={starValue <= rating ? colors.primary : colors.outlineVariant}
                />
              </Pressable>
            ))}
          </View>
          <Text style={styles.ratingText}>
            {rating > 0 && RATING_DESC_KEYS[rating] ? t(RATING_DESC_KEYS[rating]) : ''}
          </Text>
        </View>

        {/* Feedback Chips */}
        <View style={[styles.feedbackSection, rating === 0 && styles.disabledSection]}>
          <Text style={styles.feedbackTitle}>{t('rating.whatWentWell')}</Text>
          <View style={styles.chipsContainer}>
            {FEEDBACK_OPTION_KEYS.map((key) => {
              const optionText = t(key);
              const isSelected = selectedFeedback.includes(optionText);
              return (
                <Pressable
                  key={key}
                  style={[styles.chip, isSelected && styles.chipSelected]}
                  onPress={() => handleFeedbackToggle(optionText)}
                  disabled={rating === 0}
                  accessibilityRole="button"
                >
                  <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                    {optionText}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Spacer to push actions to bottom if scrollview is larger than screen */}
        <View style={{ flexGrow: 1 }} />

        {/* Actions */}
        <View style={styles.actionContainer}>
          <Pressable
            style={[styles.submitButton, rating === 0 && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={rating === 0 || isSubmitting}
            accessibilityRole="button"
          >
            {isSubmitting ? (
              <Feather name="loader" size={24} color={colors.onPrimary} style={{ opacity: 0.8 }} /> // simulated spinner
            ) : (
              <Text style={styles.submitButtonText}>{t('trip.rateDriverCaps')}</Text>
            )}
          </Pressable>
          <Pressable
            style={styles.skipButton}
            onPress={() =>
              onSkip ? onSkip() : navigation?.navigate('TripCompletedSummaryScreen')
            }
            accessibilityRole="button"
            accessibilityLabel={t('common.skip')}
          >
            <Text style={styles.skipButtonText}>{t('common.skip')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface + 'CC', // 80% opacity
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },

  // Title
  titleContainer: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    width: '100%',
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  monoText: {
    fontFamily: typography.dataMono.fontFamily,
  },

  // Driver Card
  driverCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    padding: spacing.xl,
    width: '100%',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  avatarContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: colors.surface,
    overflow: 'hidden',
    marginBottom: spacing.md,
    ...shadows.card,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  driverName: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: 4,
  },
  driverSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  driverSubText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Rating
  ratingSection: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 40,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  ratingText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    height: 16,
  },

  // Feedback
  feedbackSection: {
    width: '100%',
    marginBottom: 40,
  },
  disabledSection: {
    opacity: 0.5,
  },
  feedbackTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  chip: {
    backgroundColor: colors.surfaceVariant,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  chipSelected: {
    backgroundColor: colors.primaryContainer,
  },
  chipText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  chipTextSelected: {
    color: colors.onPrimaryContainer,
  },

  // Actions
  actionContainer: {
    width: '100%',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  submitButton: {
    width: '100%',
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  skipButton: {
    width: '100%',
    height: 48,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipButtonText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
});

export default DriverRatingScreen;
