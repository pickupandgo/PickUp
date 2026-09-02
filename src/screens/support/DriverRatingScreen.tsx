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
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { mockActiveTrip } from '../../data/mockData';

export interface DriverRatingScreenProps {
  readonly onClose?: () => void;
  readonly onSubmit?: (rating: number, feedback: string[]) => void;
  readonly onSkip?: () => void;
}

const FEEDBACK_OPTIONS = [
  'Professionalism',
  'Punctuality',
  'Careful Handling',
  'Navigation',
];

const RATING_DESCRIPTIONS: Record<number, string> = {
  1: 'Terrible',
  2: 'Poor',
  3: 'Okay',
  4: 'Good',
  5: 'Excellent',
};

const DriverRatingScreen: React.FC<DriverRatingScreenProps & { navigation?: any }> = ({
  onClose,
  onSubmit,
  onSkip,
  navigation,
}) => {
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
          >
            <Feather name="x" size={24} color={colors.onSurfaceVariant} />
          </Pressable>
          <Text style={styles.headerTitle}>Pick Up</Text>
        </View>
        <Pressable
          style={styles.iconButton}
          onPress={() => navigation?.navigate('NotificationCenterScreen')}
        >
          <Feather name="bell" size={24} color={colors.onSurfaceVariant} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.titleContainer}>
          <Text style={styles.title}>How was your delivery?</Text>
          <Text style={styles.subtitle}>
            Trip Ref: <Text style={styles.monoText}>#{mockActiveTrip.id}</Text>
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
              <Pressable key={starValue} onPress={() => setRating(starValue)}>
                <MaterialIcons
                  name={starValue <= rating ? 'star' : 'star-outline'}
                  size={48}
                  color={starValue <= rating ? colors.primary : colors.outlineVariant}
                />
              </Pressable>
            ))}
          </View>
          <Text style={styles.ratingText}>
            {rating > 0 ? RATING_DESCRIPTIONS[rating] : ''}
          </Text>
        </View>

        {/* Feedback Chips */}
        <View style={[styles.feedbackSection, rating === 0 && styles.disabledSection]}>
          <Text style={styles.feedbackTitle}>What went well?</Text>
          <View style={styles.chipsContainer}>
            {FEEDBACK_OPTIONS.map((option) => {
              const isSelected = selectedFeedback.includes(option);
              return (
                <Pressable
                  key={option}
                  style={[styles.chip, isSelected && styles.chipSelected]}
                  onPress={() => handleFeedbackToggle(option)}
                  disabled={rating === 0}
                >
                  <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                    {option}
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
          >
            {isSubmitting ? (
              <Feather name="loader" size={24} color={colors.onPrimary} style={{ opacity: 0.8 }} /> // simulated spinner
            ) : (
              <Text style={styles.submitButtonText}>SUBMIT RATING</Text>
            )}
          </Pressable>
          <Pressable
            style={styles.skipButton}
            onPress={() =>
              onSkip ? onSkip() : navigation?.navigate('TripCompletedSummaryScreen')
            }
          >
            <Text style={styles.skipButtonText}>Skip</Text>
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
